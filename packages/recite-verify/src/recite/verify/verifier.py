"""Turning an :class:`~recite.core.Extraction` into verification results.

This is the piece that knows how to be a good citizen of a shared, rate-limited
API: consult the cache first, skip the network entirely when nothing is
missing, chunk what remains so no request exceeds the server's per-request
citation cap, and map the answers back onto the citations we found locally.

That last step is not quite trivial. CourtListener runs its own copy of eyecite
server-side, which may be a different version than the one installed here, so
the two extractions can disagree at the margins. Results are therefore matched
back by *character overlap* first, falling back to the canonical citation
string, and any citation left unmatched simply has no verification rather than
being paired with the wrong answer.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from recite.core import CitationVerification, Extraction, ParsedCitation

from .cache import LookupCache
from .client import MAX_CITATIONS_PER_REQUEST, CourtListenerClient, LookupItem

__all__ = ["DEFAULT_CHUNK_SIZE", "VerificationReport", "Verifier"]

logger = logging.getLogger(__name__)

#: Comfortably under the server's cap, leaving room for the server's eyecite to
#: find a few citations ours did not.
DEFAULT_CHUNK_SIZE = 200


@dataclass
class VerificationReport:
    """Results plus a note of what it cost."""

    results: dict[int, CitationVerification]
    requests_made: int = 0
    cache_hits: int = 0
    skipped: int = 0
    """Citations with no canonical form to look up (short forms, ``Id.``)."""

    @property
    def verified(self) -> int:
        return len(self.results)


class Verifier:
    """Verifies the citations in a document against CourtListener."""

    def __init__(
        self,
        client: CourtListenerClient | None = None,
        *,
        cache: LookupCache | None = None,
        chunk_size: int = DEFAULT_CHUNK_SIZE,
    ) -> None:
        self._client = client
        self._cache = cache
        self._chunk_size = min(chunk_size, MAX_CITATIONS_PER_REQUEST)

    def verify(self, extraction: Extraction) -> VerificationReport:
        """Look up every full citation in ``extraction``.

        Short forms are skipped: ``Id.`` has nothing to look up on its own, and
        it inherits whatever the full citation it resolves to turned out to be.
        """
        candidates = [
            c for c in extraction.citations if c.is_full and c.lookup_key is not None
        ]
        report = VerificationReport(
            results={},
            skipped=len(extraction.citations) - len(candidates),
        )

        pending = self._take_from_cache(candidates, report)
        if not pending:
            return report

        if self._client is None:
            # Offline: cached answers still count, the rest simply go unchecked.
            logger.debug("no client configured; %d citations unverified", len(pending))
            return report

        for chunk_text, offset, members in self._chunks(extraction, pending):
            try:
                items = self._client.lookup_text(chunk_text)
            except Exception as exc:
                logger.warning("citation lookup failed for one chunk: %s", exc)
                continue

            report.requests_made += 1
            self._absorb(items, offset, members, report)

        return report

    # -- internals --------------------------------------------------------

    def _take_from_cache(
        self, candidates: list[ParsedCitation], report: VerificationReport
    ) -> list[ParsedCitation]:
        """Fill in what the cache knows; return what still needs looking up."""
        if self._cache is None:
            return list(candidates)

        pending: list[ParsedCitation] = []
        for citation in candidates:
            key = citation.lookup_key
            cached = self._cache.get(key, citation.index) if key else None
            if cached is None:
                pending.append(citation)
            else:
                report.results[citation.index] = cached
                report.cache_hits += 1
        return pending

    def _chunks(
        self, extraction: Extraction, pending: list[ParsedCitation]
    ) -> list[tuple[str, int, list[ParsedCitation]]]:
        """Split the document so no request carries more than the cap.

        Chunks are cut at citation boundaries and each one keeps the text
        around its citations, so the server's extractor sees the same case
        names and parentheticals a reader would.
        """
        text = extraction.text
        chunks: list[tuple[str, int, list[ParsedCitation]]] = []

        for position in range(0, len(pending), self._chunk_size):
            members = pending[position : position + self._chunk_size]
            first, last = members[0], members[-1]

            start = 0 if position == 0 else first.full_span.start
            is_final = position + self._chunk_size >= len(pending)
            end = len(text) if is_final else last.full_span.end

            chunks.append((text[start:end], start, members))

        return chunks

    def _absorb(
        self,
        items: list[LookupItem],
        offset: int,
        members: list[ParsedCitation],
        report: VerificationReport,
    ) -> None:
        """Attach each API result to the citation it describes."""
        unclaimed = list(members)

        for item in items:
            citation = _match(item, offset, unclaimed)
            if citation is None:
                logger.debug("no local citation matched %r", item.citation)
                continue

            unclaimed.remove(citation)
            result = CitationVerification(
                citation_index=citation.index,
                status=item.status,
                normalized=item.normalized,
                clusters=item.clusters,
                error_message=item.error_message,
            )
            report.results[citation.index] = result

            # Only cache answers the server actually computed. A 429 means the
            # citation was never looked up, and caching that would make the
            # next run believe a non-answer.
            if self._cache is not None and result.checked and citation.lookup_key:
                self._cache.put(citation.lookup_key, result)


def _match(
    item: LookupItem, offset: int, candidates: list[ParsedCitation]
) -> ParsedCitation | None:
    """Find the local citation an API result refers to.

    Overlap of character ranges is the strong signal; the canonical string is
    the fallback for when the two eyecite versions disagree about exactly which
    characters make up the citation.
    """
    if item.start is not None and item.end is not None:
        start, end = item.start + offset, item.end + offset
        for citation in candidates:
            if citation.span.start < end and start < citation.span.end:
                return citation

    wanted = {item.citation, *item.normalized}
    for citation in candidates:
        if citation.corrected in wanted or citation.lookup_key in wanted:
            return citation

    return None
