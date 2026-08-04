"""The CourtListener client, against a mocked endpoint.

No test here touches the network: `respx` intercepts httpx at the transport
layer, so the suite is deterministic and does not consume anyone's rate limit.
"""

from __future__ import annotations

import httpx
import pytest
import respx

from recite.verify import (
    CourtListenerClient,
    CourtListenerError,
    MissingTokenError,
    RateLimitedError,
)

URL = "https://www.courtlistener.com/api/rest/v4/citation-lookup/"

MATCHED = [
    {
        "citation": "410 U.S. 113",
        "normalized_citations": ["410 U.S. 113"],
        "start_index": 13,
        "end_index": 25,
        "status": 200,
        "error_message": "",
        "clusters": [
            {
                "id": 108713,
                "case_name": "Roe v. Wade",
                "date_filed": "1973-01-22",
                "absolute_url": "/opinion/108713/roe-v-wade/",
                "citations": [{"volume": 410, "reporter": "U.S.", "page": "113"}],
            }
        ],
    }
]


@pytest.fixture
def client():
    with CourtListenerClient(token="test-token") as c:
        yield c


class TestConstruction:
    def test_a_token_is_required(self, monkeypatch):
        monkeypatch.delenv("COURTLISTENER_API_TOKEN", raising=False)
        with pytest.raises(MissingTokenError, match="token is required"):
            CourtListenerClient()

    def test_the_token_is_read_from_the_environment(self, monkeypatch):
        monkeypatch.setenv("COURTLISTENER_API_TOKEN", "from-env")
        with CourtListenerClient() as client:
            assert client._client.headers["Authorization"] == "Token from-env"


class TestLookup:
    @respx.mock
    def test_parses_a_match(self, client):
        respx.post(URL).mock(return_value=httpx.Response(200, json=MATCHED))
        (item,) = client.lookup_text("Roe v. Wade, 410 U.S. 113 (1973).")

        assert item.status == 200
        assert item.start == 13
        assert (item.clusters[0].case_name, item.clusters[0].year) == (
            "Roe v. Wade",
            1973,
        )
        assert item.clusters[0].citations == ("410 U.S. 113",)
        assert item.clusters[0].url == (
            "https://www.courtlistener.com/opinion/108713/roe-v-wade/"
        )

    @respx.mock
    def test_sends_the_text_as_form_data(self, client):
        route = respx.post(URL).mock(return_value=httpx.Response(200, json=[]))
        client.lookup_text("some brief")
        assert b"text=some+brief" in route.calls[0].request.content

    @respx.mock
    def test_structured_lookup_sends_the_parts(self, client):
        route = respx.post(URL).mock(return_value=httpx.Response(200, json=[]))
        client.lookup_citation("410", "U.S.", "113")
        body = route.calls[0].request.content
        assert b"volume=410" in body and b"page=113" in body

    @respx.mock
    def test_a_not_found_status_still_parses(self, client):
        respx.post(URL).mock(
            return_value=httpx.Response(
                200,
                json=[{"citation": "999 U.S. 1", "status": 404, "clusters": []}],
            )
        )
        (item,) = client.lookup_text("999 U.S. 1")
        assert item.status == 404
        assert item.clusters == ()

    @respx.mock
    def test_unknown_response_fields_are_ignored(self, client):
        respx.post(URL).mock(
            return_value=httpx.Response(
                200,
                json=[
                    {
                        "citation": "410 U.S. 113",
                        "status": 200,
                        "clusters": [{"id": 1, "case_name": "X", "brand_new": "?"}],
                        "future_field": [1, 2, 3],
                    }
                ],
            )
        )
        (item,) = client.lookup_text("410 U.S. 113")
        assert item.clusters[0].case_name == "X"


class TestErrors:
    @respx.mock
    def test_a_bad_token_is_reported_clearly(self, client):
        respx.post(URL).mock(return_value=httpx.Response(403))
        with pytest.raises(CourtListenerError, match="rejected the API token"):
            client.lookup_text("x")

    @respx.mock
    def test_persistent_throttling_raises(self, client, monkeypatch):
        monkeypatch.setattr("time.sleep", lambda _: None)
        respx.post(URL).mock(
            return_value=httpx.Response(429, headers={"Retry-After": "1"})
        )
        with pytest.raises(RateLimitedError) as excinfo:
            client.lookup_text("x")
        assert excinfo.value.retry_after == 1.0

    @respx.mock
    def test_a_server_error_is_retried_then_succeeds(self, client, monkeypatch):
        monkeypatch.setattr("time.sleep", lambda _: None)
        route = respx.post(URL).mock(
            side_effect=[
                httpx.Response(503),
                httpx.Response(200, json=MATCHED),
            ]
        )
        (item,) = client.lookup_text("Roe v. Wade, 410 U.S. 113 (1973).")
        assert item.status == 200
        assert route.call_count == 2

    @respx.mock
    def test_a_non_list_body_is_rejected(self, client):
        respx.post(URL).mock(return_value=httpx.Response(200, json={"detail": "nope"}))
        with pytest.raises(CourtListenerError, match="expected a list"):
            client.lookup_text("x")
