"""CLI behaviour: exit codes, output formats, and not touching the network."""

from __future__ import annotations

import json

import pytest
from typer.testing import CliRunner

from recite.cli.main import app

BRIEF = """\
Bell Atl. Corp. v. Twombly, 550 US 544, 570 (2007).
Delta v. Epsilon, 999 F.3d 1 (2d Cir. 1950).
"""

CLEAN = "Roe v. Wade, 410 U.S. 113, 116 (1973).\n"


@pytest.fixture
def runner():
    return CliRunner()


@pytest.fixture
def brief(tmp_path):
    path = tmp_path / "brief.txt"
    path.write_text(BRIEF, encoding="utf-8")
    return path


@pytest.fixture(autouse=True)
def force_offline(monkeypatch):
    """No test in this file may reach CourtListener."""
    monkeypatch.setenv("RECITE_OFFLINE", "1")
    monkeypatch.delenv("COURTLISTENER_API_TOKEN", raising=False)


class TestCheck:
    def test_errors_exit_1(self, runner, brief):
        result = runner.invoke(app, ["check", str(brief)])
        assert result.exit_code == 1
        assert "DT001" in result.stdout

    def test_a_clean_file_exits_0(self, runner, tmp_path):
        path = tmp_path / "clean.txt"
        path.write_text(CLEAN, encoding="utf-8")
        result = runner.invoke(app, ["check", str(path)])
        assert result.exit_code == 0
        assert "✓" in result.stdout

    def test_style_notes_alone_do_not_fail_the_build(self, runner, tmp_path):
        path = tmp_path / "style.txt"
        path.write_text("A v. B, 550 US 544 (2007).\n", encoding="utf-8")
        result = runner.invoke(app, ["check", str(path)])
        assert result.exit_code == 0
        assert "RP001" in result.stdout

    def test_json_output_is_valid(self, runner, brief):
        result = runner.invoke(app, ["check", str(brief), "--format", "json"])
        payload = json.loads(result.stdout)
        assert payload[0]["path"] == str(brief)
        assert any(d["rule"] == "DT001" for d in payload[0]["diagnostics"])

    def test_sarif_output_is_valid(self, runner, brief):
        result = runner.invoke(app, ["check", str(brief), "--format", "sarif"])
        payload = json.loads(result.stdout)
        assert payload["version"] == "2.1.0"
        assert payload["runs"][0]["tool"]["driver"]["name"] == "ReCite"
        assert payload["runs"][0]["results"]

    def test_sarif_levels_are_the_sarif_vocabulary(self, runner, brief):
        result = runner.invoke(app, ["check", str(brief), "--format", "sarif"])
        payload = json.loads(result.stdout)
        levels = {r["level"] for r in payload["runs"][0]["results"]}
        assert levels <= {"error", "warning", "note"}

    def test_an_unknown_format_is_rejected(self, runner, brief):
        result = runner.invoke(app, ["check", str(brief), "--format", "yaml"])
        assert result.exit_code == 2

    def test_an_unknown_rule_name_is_rejected(self, runner, brief):
        result = runner.invoke(app, ["check", str(brief), "--select", "ZZ999"])
        assert result.exit_code == 2
        assert "unknown rule" in result.stderr

    def test_selecting_a_rule_narrows_the_report(self, runner, brief):
        result = runner.invoke(app, ["check", str(brief), "--select", "RP001"])
        assert "DT001" not in result.stdout
        assert result.exit_code == 0  # RP001 alone is only a style note

    def test_a_missing_file_exits_2(self, runner, tmp_path):
        result = runner.invoke(app, ["check", str(tmp_path / "nope.txt")])
        assert result.exit_code == 2

    def test_reads_stdin(self, runner):
        result = runner.invoke(app, ["check", "-"], input=BRIEF)
        assert result.exit_code == 1
        assert "<stdin>" in result.stdout


class TestFix:
    def test_diff_is_the_default_and_leaves_the_file_alone(self, runner, brief):
        result = runner.invoke(app, ["fix", str(brief)])
        assert "+Bell Atl. Corp. v. Twombly, 550 U.S. 544, 570 (2007)." in result.stdout
        assert brief.read_text(encoding="utf-8") == BRIEF

    def test_write_edits_in_place(self, runner, brief):
        runner.invoke(app, ["fix", str(brief), "--write"])
        assert "550 U.S. 544" in brief.read_text(encoding="utf-8")

    def test_unsafe_is_required_for_substantive_changes(self, runner, brief):
        runner.invoke(app, ["fix", str(brief), "--write"])
        assert "999 F.3d 1" in brief.read_text(encoding="utf-8")

        runner.invoke(app, ["fix", str(brief), "--write", "--unsafe"])
        assert "999 F.2d 1" in brief.read_text(encoding="utf-8")

    def test_fixing_stdin_writes_only_the_document_to_stdout(self, runner):
        result = runner.invoke(app, ["fix", "-", "--write"], input=BRIEF)
        assert result.stdout == BRIEF.replace("550 US 544", "550 U.S. 544")

    def test_a_clean_document_still_comes_back_out_of_the_pipe(self, runner):
        # `recite fix - --write > out.txt` must never truncate the document
        # just because there was nothing to correct.
        result = runner.invoke(app, ["fix", "-", "--write"], input=CLEAN)
        assert result.stdout == CLEAN

    def test_a_clean_file_produces_no_diff(self, runner, tmp_path):
        path = tmp_path / "clean.txt"
        path.write_text(CLEAN, encoding="utf-8")
        result = runner.invoke(app, ["fix", str(path)])
        assert result.exit_code == 0
        assert "---" not in result.stdout


class TestInformationalCommands:
    def test_rules_lists_every_rule(self, runner):
        from recite.rules import all_rules

        result = runner.invoke(app, ["rules"])
        assert result.exit_code == 0
        for rule in all_rules():
            assert rule.id in result.stdout

    def test_rules_explains_one_rule(self, runner):
        result = runner.invoke(app, ["rules", "DT001"])
        assert "year-outside-edition" in result.stdout

    def test_rules_rejects_an_unknown_id(self, runner):
        assert runner.invoke(app, ["rules", "ZZ999"]).exit_code == 2

    def test_extract_emits_json(self, runner, brief):
        result = runner.invoke(app, ["extract", str(brief)])
        payload = json.loads(result.stdout)
        assert [c["corrected"] for c in payload[0]["citations"]] == [
            "550 U.S. 544",
            "999 F.3d 1",
        ]

    def test_info_reporter_shows_the_series(self, runner):
        result = runner.invoke(app, ["info", "reporter", "F.3d"])
        assert "1993" in result.stdout and "F.2d" in result.stdout

    def test_info_reporter_rejects_an_unknown_name(self, runner):
        assert runner.invoke(app, ["info", "reporter", "Zzz."]).exit_code == 2

    def test_info_court_resolves_an_id(self, runner):
        result = runner.invoke(app, ["info", "court", "ca9"])
        assert "9th Cir." in result.stdout

    def test_version_lists_the_packages(self, runner):
        result = runner.invoke(app, ["version"])
        assert "recite-core" in result.stdout


class TestOfflineEnforcement:
    def test_verify_is_ignored_when_offline_is_set(self, runner, brief):
        # RECITE_OFFLINE is set by the autouse fixture; --verify must not then
        # try (and fail) to build a client.
        result = runner.invoke(app, ["check", str(brief), "--verify"])
        assert result.exit_code == 1
        assert "token" not in result.stderr

    def test_lookup_refuses_to_run_offline(self, runner):
        result = runner.invoke(app, ["lookup", "410 U.S. 113"])
        assert result.exit_code == 2

    def test_verify_without_a_token_fails_clearly(self, runner, brief, monkeypatch):
        monkeypatch.delenv("RECITE_OFFLINE", raising=False)
        result = runner.invoke(app, ["check", str(brief), "--verify"])
        assert result.exit_code == 2
        assert "token is required" in result.stderr
