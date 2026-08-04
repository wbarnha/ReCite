"""A thin client for the CourtListener citation-lookup API.

The API takes a block of text, extracts the citations in it with eyecite (the
same library ReCite uses locally), matches each against the CourtListener
database, and returns one object per citation carrying a status and any
matching opinion clusters.

Two properties of the endpoint shape this module:

* **It is rate limited**, and generously so only for authenticated callers.
  Without a token there is nothing useful to do, so :class:`CourtListenerClient`
  refuses to be constructed without one.
* **It caps each request at 250 citations.** Citations past the cap come back
  with status 429 rather than being matched, so the caller has to chunk. That
  is :mod:`recite.verify.verifier`'s job; this module speaks to the endpoint.

See https://www.courtlistener.com/help/api/rest/citation-lookup/
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Any

import httpx

from recite.core import VerifiedCluster

__all__ = [
    "DEFAULT_BASE_URL",
    "MAX_CITATIONS_PER_REQUEST",
    "CourtListenerClient",
    "CourtListenerError",
    "LookupItem",
    "MissingTokenError",
    "RateLimitedError",
]

DEFAULT_BASE_URL = "https://www.courtlistener.com"
CITATION_LOOKUP_PATH = "/api/rest/v4/citation-lookup/"

#: The server looks up at most this many citations per request; the rest come
#: back with status 429 and no clusters.
MAX_CITATIONS_PER_REQUEST = 250

TOKEN_ENV_VAR = "COURTLISTENER_API_TOKEN"


class CourtListenerError(RuntimeError):
    """The API could not be reached, or answered with something unusable."""


class MissingTokenError(CourtListenerError):
    """No API token was supplied, so no request was attempted."""


class RateLimitedError(CourtListenerError):
    """The API asked us to slow down and we ran out of retries."""

    def __init__(self, message: str, retry_after: float | None = None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


@dataclass(frozen=True)
class LookupItem:
    """One entry from a citation-lookup response, before it is tied to a citation.

    ``start`` and ``end`` are offsets into the text *as sent*, which is how the
    verifier maps results back onto the citations it found locally.
    """

    citation: str
    status: int
    start: int | None
    end: int | None
    normalized: tuple[str, ...]
    clusters: tuple[VerifiedCluster, ...]
    error_message: str | None


class CourtListenerClient:
    """Blocking client for the citation-lookup endpoint.

    Usable as a context manager, which closes the underlying connection pool::

        with CourtListenerClient() as client:
            items = client.lookup_text(brief)
    """

    def __init__(
        self,
        token: str | None = None,
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = 30.0,
        max_retries: int = 3,
        user_agent: str = "ReCite/0.1 (+https://github.com/wbarnha/ReCite)",
        client: httpx.Client | None = None,
    ) -> None:
        resolved = token or os.environ.get(TOKEN_ENV_VAR)
        if not resolved:
            raise MissingTokenError(
                f"A CourtListener API token is required. Set ${TOKEN_ENV_VAR} or "
                f"pass token=..., or run with --offline to skip verification. "
                f"Tokens are free: https://www.courtlistener.com/help/api/rest/"
            )

        self._token = resolved
        self._base_url = base_url.rstrip("/")
        self._max_retries = max_retries
        self._owns_client = client is None
        self._client = client or httpx.Client(
            timeout=timeout,
            headers={
                "Authorization": f"Token {resolved}",
                "User-Agent": user_agent,
            },
        )

    # -- lifecycle --------------------------------------------------------

    def __enter__(self) -> CourtListenerClient:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    # -- requests ---------------------------------------------------------

    def lookup_text(self, text: str) -> list[LookupItem]:
        """Look up every citation in ``text``.

        Offsets on the returned items refer to ``text``, so callers that chunk
        a document must add the chunk's own offset back on.
        """
        return self._post({"text": text})

    def lookup_citation(
        self, volume: str, reporter: str, page: str
    ) -> list[LookupItem]:
        """Look up a single citation by its parts, skipping extraction."""
        return self._post({"volume": volume, "reporter": reporter, "page": page})

    def _post(self, data: dict[str, str]) -> list[LookupItem]:
        url = f"{self._base_url}{CITATION_LOOKUP_PATH}"
        last_error: Exception | None = None

        for attempt in range(self._max_retries):
            try:
                response = self._client.post(url, data=data)
            except httpx.HTTPError as exc:
                last_error = exc
                _sleep_backoff(attempt)
                continue

            # A 429 on the *response* (as opposed to a per-citation status) is
            # the throttle telling us to wait, and it usually says for how long.
            if response.status_code == 429:
                retry_after = _retry_after(response)
                if attempt + 1 >= self._max_retries:
                    raise RateLimitedError(
                        "CourtListener rate limit reached; try again later or "
                        "run with --offline.",
                        retry_after,
                    )
                time.sleep(retry_after if retry_after is not None else 2.0**attempt)
                continue

            if response.status_code in (401, 403):
                raise CourtListenerError(
                    f"CourtListener rejected the API token "
                    f"({response.status_code}). Check ${TOKEN_ENV_VAR}."
                )

            if response.status_code >= 500:
                last_error = CourtListenerError(
                    f"CourtListener returned {response.status_code}"
                )
                _sleep_backoff(attempt)
                continue

            if response.status_code >= 400:
                raise CourtListenerError(
                    f"CourtListener returned {response.status_code}: "
                    f"{response.text[:200]}"
                )

            return _parse(response.json())

        raise CourtListenerError(
            f"CourtListener request failed after {self._max_retries} attempts: "
            f"{last_error}"
        )


def _sleep_backoff(attempt: int) -> None:
    time.sleep(2.0**attempt)


def _retry_after(response: httpx.Response) -> float | None:
    raw = response.headers.get("Retry-After")
    try:
        return float(raw) if raw else None
    except ValueError:
        return None


def _parse(payload: Any) -> list[LookupItem]:
    """Turn the JSON body into :class:`LookupItem` objects.

    Written defensively on purpose: this is a third-party API whose response
    may gain fields, and a new key should never crash a citation check.
    """
    if not isinstance(payload, list):
        raise CourtListenerError(
            f"expected a list of citation results, got {type(payload).__name__}"
        )

    items: list[LookupItem] = []
    for entry in payload:
        if not isinstance(entry, dict):
            continue
        items.append(
            LookupItem(
                citation=str(entry.get("citation") or ""),
                status=int(entry.get("status") or 0),
                start=_maybe_int(entry.get("start_index")),
                end=_maybe_int(entry.get("end_index")),
                normalized=tuple(entry.get("normalized_citations") or ()),
                clusters=tuple(
                    _parse_cluster(c)
                    for c in (entry.get("clusters") or [])
                    if isinstance(c, dict)
                ),
                error_message=entry.get("error_message") or None,
            )
        )
    return items


def _parse_cluster(raw: dict[str, Any]) -> VerifiedCluster:
    return VerifiedCluster(
        cluster_id=_maybe_int(raw.get("id")),
        case_name=raw.get("case_name") or raw.get("case_name_full") or None,
        date_filed=_stringify(raw.get("date_filed")),
        absolute_url=raw.get("absolute_url") or None,
        citations=tuple(_citation_strings(raw.get("citations"))),
    )


def _citation_strings(raw: Any) -> list[str]:
    """Flatten the cluster's citations, which may be strings or objects."""
    if not isinstance(raw, list):
        return []

    out: list[str] = []
    for item in raw:
        if isinstance(item, str):
            out.append(item)
        elif isinstance(item, dict):
            volume, reporter, page = (
                item.get("volume"),
                item.get("reporter"),
                item.get("page"),
            )
            if volume and reporter and page:
                out.append(f"{volume} {reporter} {page}")
    return out


def _maybe_int(value: Any) -> int | None:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _stringify(value: Any) -> str | None:
    return str(value) if value is not None else None
