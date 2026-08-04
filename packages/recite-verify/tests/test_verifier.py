"""Chunking, cache behaviour, and mapping API answers back onto our citations."""

from __future__ import annotations

import pytest

from recite.core import CitationVerification, VerifiedCluster, extract
from recite.verify import LookupCache, Verifier
from recite.verify.client import LookupItem


class FakeClient:
    """Stands in for CourtListenerClient, recording what it was asked."""

    def __init__(self, responder=None):
        self.requests: list[str] = []
        self._responder = responder or (lambda text: [])

    def lookup_text(self, text: str) -> list[LookupItem]:
        self.requests.append(text)
        return self._responder(text)


def item(citation: str, start: int, end: int, status: int = 200, name: str = "A v. B"):
    return LookupItem(
        citation=citation,
        status=status,
        start=start,
        end=end,
        normalized=(citation,),
        clusters=(
            VerifiedCluster(cluster_id=1, case_name=name, date_filed="1973-01-22"),
        )
        if status == 200
        else (),
        error_message=None,
    )


@pytest.fixture
def cache(tmp_path):
    return LookupCache(tmp_path / "cache.sqlite3")


class TestMatching:
    def test_a_result_is_attached_by_character_overlap(self):
        text = "Roe v. Wade, 410 U.S. 113 (1973)."
        extraction = extract(text)
        span = extraction.citations[0].span

        client = FakeClient(lambda _: [item("410 U.S. 113", span.start, span.end)])
        report = Verifier(client).verify(extraction)

        assert report.results[0].status == 200
        assert report.results[0].clusters[0].case_name == "A v. B"

    def test_falls_back_to_the_citation_string_when_offsets_are_absent(self):
        extraction = extract("Roe v. Wade, 410 U.S. 113 (1973).")
        client = FakeClient(
            lambda _: [
                LookupItem("410 U.S. 113", 200, None, None, ("410 U.S. 113",), (), None)
            ]
        )
        report = Verifier(client).verify(extraction)
        assert 0 in report.results

    def test_an_unmatched_result_is_dropped_rather_than_misassigned(self):
        extraction = extract("Roe v. Wade, 410 U.S. 113 (1973).")
        client = FakeClient(lambda _: [item("999 F.2d 8", 5000, 5010)])
        report = Verifier(client).verify(extraction)
        assert report.results == {}

    def test_short_forms_are_never_looked_up(self):
        extraction = extract("Roe v. Wade, 410 U.S. 113 (1973). Id. at 116.")
        client = FakeClient(lambda _: [])
        report = Verifier(client).verify(extraction)
        assert report.skipped == 1


class TestChunking:
    def _document(self, count: int) -> str:
        return " ".join(
            f"Case{n} v. Other{n}, {n + 1} U.S. {n + 1} (1900)." for n in range(count)
        )

    def test_a_small_document_is_one_request(self):
        client = FakeClient()
        Verifier(client).verify(extract(self._document(5)))
        assert len(client.requests) == 1

    def test_a_large_document_is_split_under_the_cap(self):
        client = FakeClient()
        extraction = extract(self._document(12))
        Verifier(client, chunk_size=5).verify(extraction)
        assert len(client.requests) == 3

    def test_chunk_size_is_capped_at_the_server_limit(self):
        assert Verifier(FakeClient(), chunk_size=10_000)._chunk_size == 250

    def test_every_chunk_carries_real_text(self):
        client = FakeClient()
        Verifier(client, chunk_size=4).verify(extract(self._document(10)))
        assert all(request.strip() for request in client.requests)


class TestCaching:
    def test_a_result_is_reused_on_the_next_run(self, cache):
        text = "Roe v. Wade, 410 U.S. 113 (1973)."
        extraction = extract(text)
        span = extraction.citations[0].span
        client = FakeClient(lambda _: [item("410 U.S. 113", span.start, span.end)])

        first = Verifier(client, cache=cache).verify(extraction)
        assert (first.requests_made, first.cache_hits) == (1, 0)

        second = Verifier(client, cache=cache).verify(extraction)
        assert (second.requests_made, second.cache_hits) == (0, 1)
        assert second.results[0].from_cache

    def test_a_fully_cached_document_makes_no_request(self, cache):
        extraction = extract("Roe v. Wade, 410 U.S. 113 (1973).")
        span = extraction.citations[0].span
        client = FakeClient(lambda _: [item("410 U.S. 113", span.start, span.end)])

        Verifier(client, cache=cache).verify(extraction)
        client.requests.clear()
        Verifier(client, cache=cache).verify(extraction)
        assert client.requests == []

    def test_an_unexamined_citation_is_not_cached(self, cache):
        # Status 429 means the server never looked it up; caching that would
        # make the next run believe a non-answer.
        extraction = extract("Roe v. Wade, 410 U.S. 113 (1973).")
        span = extraction.citations[0].span
        client = FakeClient(
            lambda _: [item("410 U.S. 113", span.start, span.end, status=429)]
        )
        Verifier(client, cache=cache).verify(extraction)
        assert len(cache) == 0

    def test_offline_verifier_returns_only_cached_answers(self, cache):
        extraction = extract("Roe v. Wade, 410 U.S. 113 (1973).")
        span = extraction.citations[0].span
        online = FakeClient(lambda _: [item("410 U.S. 113", span.start, span.end)])
        Verifier(online, cache=cache).verify(extraction)

        offline = Verifier(None, cache=cache).verify(extraction)
        assert offline.cache_hits == 1
        assert offline.requests_made == 0

    def test_a_failed_request_does_not_abort_the_run(self):
        def explode(_):
            raise RuntimeError("network down")

        report = Verifier(FakeClient(explode)).verify(
            extract("Roe v. Wade, 410 U.S. 113 (1973).")
        )
        assert report.results == {}


class TestCacheStore:
    def test_round_trips_a_result(self, cache):
        stored = CitationVerification(
            citation_index=0,
            status=200,
            normalized=("410 U.S. 113",),
            clusters=(
                VerifiedCluster(
                    cluster_id=7,
                    case_name="Roe v. Wade",
                    date_filed="1973-01-22",
                    absolute_url="/opinion/7/",
                    citations=("410 U.S. 113",),
                ),
            ),
        )
        cache.put("410 U.S. 113", stored)

        loaded = cache.get("410 U.S. 113", citation_index=3)
        assert loaded is not None
        assert loaded.citation_index == 3
        assert loaded.from_cache
        assert loaded.clusters[0].case_name == "Roe v. Wade"
        assert loaded.clusters[0].citations == ("410 U.S. 113",)

    def test_a_missing_key_returns_none(self, cache):
        assert cache.get("1 U.S. 1", 0) is None

    def test_expired_entries_are_ignored(self, tmp_path):
        store = LookupCache(tmp_path / "c.sqlite3", ttl_seconds=-1)
        store.put("1 U.S. 1", CitationVerification(citation_index=0, status=200))
        assert store.get("1 U.S. 1", 0) is None

    def test_clear_empties_the_store(self, cache):
        cache.put("1 U.S. 1", CitationVerification(citation_index=0, status=200))
        assert cache.clear() == 1
        assert len(cache) == 0
