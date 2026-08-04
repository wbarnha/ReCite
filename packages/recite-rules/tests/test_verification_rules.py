"""The VF family, driven by synthetic CourtListener results."""

from __future__ import annotations

from recite.core import Severity
from recite.rules import (
    AmbiguousAuthority,
    CaseNameMismatch,
    UnknownAuthority,
    YearMismatch,
    all_rules,
    select_rules,
)

CITE = "Roe v. Wade, 410 U.S. 113 (1973)."


class TestUnknownAuthority:
    def test_a_404_is_an_error(self, check, verification):
        (found,) = check(
            CITE, UnknownAuthority(), verifications={0: verification(status=404)}
        )
        assert found.severity is Severity.ERROR
        assert found.correction is None

    def test_a_match_is_not_reported(self, check, verification):
        assert check(CITE, UnknownAuthority(), verifications={0: verification()}) == []

    def test_without_verification_the_rule_is_inert(self, check):
        assert check(CITE, UnknownAuthority()) == []


class TestAmbiguousAuthority:
    def test_a_300_lists_the_candidates(self, check, verification):
        (found,) = check(
            CITE,
            AmbiguousAuthority(),
            verifications={
                0: verification(status=300, case_name="Smith", cluster_count=2)
            },
        )
        assert found.severity is Severity.WARNING
        assert len(found.context["candidates"]) == 2


class TestCaseNameMismatch:
    def test_a_different_case_at_that_citation_is_an_error(self, check, verification):
        (found,) = check(
            CITE,
            CaseNameMismatch(),
            verifications={0: verification(case_name="Brown v. Board of Education")},
        )
        assert found.severity is Severity.ERROR
        assert "Brown" in found.message

    def test_the_same_case_spelled_differently_is_accepted(self, check, verification):
        found = check(
            "Bell Atl. Corp. v. Twombly, 550 U.S. 544 (2007).",
            CaseNameMismatch(),
            verifications={
                0: verification(case_name="Bell Atlantic Corporation v. Twombly")
            },
        )
        assert found == []

    def test_an_exact_match_is_accepted(self, check, verification):
        assert (
            check(
                CITE,
                CaseNameMismatch(),
                verifications={0: verification(case_name="Roe v. Wade")},
            )
            == []
        )

    def test_a_missing_case_name_is_not_accused(self, check, verification):
        found = check(
            "The court cited 410 U.S. 113 there.",
            CaseNameMismatch(),
            verifications={0: verification(case_name="Roe v. Wade")},
        )
        assert found == []


class TestYearMismatch:
    def test_a_different_year_is_a_warning(self, check, verification):
        (found,) = check(
            CITE,
            YearMismatch(),
            verifications={
                0: verification(case_name="Roe v. Wade", date_filed="1971-05-21")
            },
        )
        assert found.severity is Severity.WARNING
        assert found.context["actual_year"] == 1971

    def test_the_year_is_never_rewritten_automatically(self, check, verification):
        (found,) = check(
            CITE,
            YearMismatch(),
            verifications={
                0: verification(case_name="Roe v. Wade", date_filed="1971-05-21")
            },
        )
        assert found.correction is None

    def test_a_matching_year_is_silent(self, check, verification):
        assert (
            check(
                CITE,
                YearMismatch(),
                verifications={
                    0: verification(case_name="Roe v. Wade", date_filed="1973-01-22")
                },
            )
            == []
        )


class TestRegistry:
    def test_offline_selection_drops_the_network_rules(self):
        offline = select_rules(include_verification=False)
        assert offline
        assert not any(rule.requires_verification for rule in offline)

    def test_every_rule_id_is_unique(self):
        ids = [rule.id for rule in all_rules()]
        assert len(ids) == len(set(ids))

    def test_selecting_by_name_and_by_id_agree(self):
        assert select_rules(enable=["RP001"]) == select_rules(
            enable=["reporter-format"]
        )

    def test_ignoring_removes_only_that_rule(self):
        remaining = select_rules(disable=["RP001"])
        assert "RP001" not in [r.id for r in remaining]
        assert len(remaining) == len(all_rules()) - 1
