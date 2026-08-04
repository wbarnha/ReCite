"""The whole stack with verification on, against a mocked CourtListener.

The individual pieces are covered in their own packages; what this file pins is
the wiring — that API results actually reach the ``VF`` rules with the right
citation attached.
"""

from __future__ import annotations

import httpx
import pytest
import respx

from recite.core import Severity
from recite.fix import Engine
from recite.verify import CourtListenerClient, LookupCache, Verifier

URL = "https://www.courtlistener.com/api/rest/v4/citation-lookup/"

BRIEF = "Plaintiff relies on Roe v. Wade, 410 U.S. 113 (1973), which controls."


def lookup_response(text: str, needle: str = "410 U.S. 113", **overrides):
    """One 200-status result positioned over the citation in ``text``.

    ``needle`` is how the citation is spelled in this particular document,
    which is not always the canonical form the API echoes back.
    """
    start = text.index(needle)
    entry = {
        "citation": "410 U.S. 113",
        "normalized_citations": ["410 U.S. 113"],
        "start_index": start,
        "end_index": start + len(needle),
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
    entry.update(overrides)
    return [entry]


@pytest.fixture
def engine(tmp_path):
    client = CourtListenerClient(token="test-token")
    verifier = Verifier(client, cache=LookupCache(tmp_path / "cache.sqlite3"))
    engine = Engine(verifier=verifier, current_year=2026)
    yield engine
    client.close()


def rule_ids(result):
    return {d.rule_id for d in result.diagnostics}


class TestVerifiedRun:
    def test_verification_rules_are_enabled_when_a_verifier_is_present(self, engine):
        assert any(rule.requires_verification for rule in engine.rules)

    @respx.mock
    def test_a_confirmed_citation_produces_no_findings(self, engine):
        respx.post(URL).mock(
            return_value=httpx.Response(200, json=lookup_response(BRIEF))
        )
        result = engine.check_text(BRIEF, "brief.txt")
        assert result.ok
        assert result.verification is not None
        assert result.verification.verified == 1

    @respx.mock
    def test_a_citation_in_no_database_is_an_error(self, engine):
        respx.post(URL).mock(
            return_value=httpx.Response(
                200, json=lookup_response(BRIEF, status=404, clusters=[])
            )
        )
        result = engine.check_text(BRIEF, "brief.txt")
        assert "VF001" in rule_ids(result)
        assert result.error_count == 1

    @respx.mock
    def test_a_real_citation_with_the_wrong_case_name_is_caught(self, engine):
        text = "See Brown v. Board of Education, 410 U.S. 113 (1973)."
        respx.post(URL).mock(
            return_value=httpx.Response(200, json=lookup_response(text))
        )
        result = engine.check_text(text, "brief.txt")
        assert "VF003" in rule_ids(result)
        assert "Roe v. Wade" in next(
            d.message for d in result.diagnostics if d.rule_id == "VF003"
        )

    @respx.mock
    def test_a_disagreeing_year_is_a_warning_with_no_fix(self, engine):
        text = "See Roe v. Wade, 410 U.S. 113 (1975)."
        respx.post(URL).mock(
            return_value=httpx.Response(200, json=lookup_response(text))
        )
        result = engine.check_text(text, "brief.txt")

        (found,) = [d for d in result.diagnostics if d.rule_id == "VF004"]
        assert found.severity is Severity.WARNING
        assert found.correction is None

    @respx.mock
    def test_an_ambiguous_citation_is_reported(self, engine):
        respx.post(URL).mock(
            return_value=httpx.Response(
                200,
                json=lookup_response(
                    BRIEF,
                    status=300,
                    clusters=[
                        {
                            "id": 1,
                            "case_name": "Roe v. Wade",
                            "date_filed": "1973-01-22",
                        },
                        {
                            "id": 2,
                            "case_name": "Doe v. Bolton",
                            "date_filed": "1973-01-22",
                        },
                    ],
                ),
            )
        )
        assert "VF002" in rule_ids(engine.check_text(BRIEF, "brief.txt"))

    @respx.mock
    def test_offline_and_verified_runs_agree_about_formatting(self, engine):
        text = "See Roe v. Wade, 410 U. S. 113 (1973)."
        respx.post(URL).mock(
            return_value=httpx.Response(
                200, json=lookup_response(text, needle="410 U. S. 113")
            )
        )
        online = engine.fix_text(text, "brief.txt").fixed_text
        offline = Engine(current_year=2026).fix_text(text, "brief.txt").fixed_text
        assert online == offline == "See Roe v. Wade, 410 U.S. 113 (1973)."

    @respx.mock
    def test_the_second_run_is_served_from_cache(self, engine):
        route = respx.post(URL).mock(
            return_value=httpx.Response(200, json=lookup_response(BRIEF))
        )
        engine.check_text(BRIEF, "brief.txt")
        second = engine.check_text(BRIEF, "brief.txt")

        assert route.call_count == 1
        assert second.verification is not None
        assert second.verification.cache_hits == 1

    @respx.mock
    def test_an_api_outage_degrades_to_the_offline_rules(self, engine, monkeypatch):
        monkeypatch.setattr("time.sleep", lambda _: None)
        respx.post(URL).mock(return_value=httpx.Response(503))

        text = "See Roe v. Wade, 410 U. S. 113 (1973)."
        result = engine.check_text(text, "brief.txt")

        # The formatting rules still ran; no VF rule invented a finding from
        # the absence of an answer.
        assert "RP001" in rule_ids(result)
        assert not any(r.startswith("VF") for r in rule_ids(result))


@pytest.mark.network
def test_live_citation_lookup():
    """Opt-in smoke test against the real API.

    Deselected by ``make test`` and CI. Run it deliberately with a token:
    ``COURTLISTENER_API_TOKEN=... uv run pytest -m network``.
    """
    import os

    if not os.environ.get("COURTLISTENER_API_TOKEN"):
        pytest.skip("COURTLISTENER_API_TOKEN is not set")

    with CourtListenerClient() as client:
        engine = Engine(verifier=Verifier(client), current_year=2026)
        result = engine.check_text(BRIEF, "brief.txt")

    assert result.verification is not None
    assert result.verification.verified == 1
    assert not any(d.rule_id == "VF001" for d in result.diagnostics)
