"""The pipeline that ties everything together.

::

    document ─▶ extract ─▶ [verify] ─▶ rules ─▶ diagnostics ─▶ [apply fixes]
                (core)     (verify)   (rules)                     (core.text)

:meth:`Engine.check` stops at diagnostics; :meth:`Engine.fix` continues and
returns the rewritten document. Everything above this layer — the CLI, an
editor plugin, a CI job — should only need these two calls.
"""

from __future__ import annotations

import datetime as _dt
from dataclasses import dataclass, field
from pathlib import Path

from recite.core import (
    Correction,
    Diagnostic,
    Extraction,
    FixSafety,
    Severity,
    apply_corrections,
    extract,
    unified_diff,
)
from recite.rules import Rule, RuleContext, run_rules, select_rules
from recite.verify import VerificationReport, Verifier

__all__ = ["CheckResult", "Engine", "FixResult"]


@dataclass
class CheckResult:
    """What one document looks like after checking it."""

    path: str
    text: str
    extraction: Extraction
    diagnostics: list[Diagnostic] = field(default_factory=list)
    verification: VerificationReport | None = None

    def counts(self) -> dict[Severity, int]:
        counts = dict.fromkeys(Severity, 0)
        for diagnostic in self.diagnostics:
            counts[diagnostic.severity] += 1
        return counts

    @property
    def error_count(self) -> int:
        return sum(1 for d in self.diagnostics if d.severity is Severity.ERROR)

    @property
    def ok(self) -> bool:
        return not self.diagnostics

    def fixable(self, *, unsafe: bool = False) -> list[Diagnostic]:
        """Diagnostics carrying a correction we are allowed to apply."""
        return [
            d
            for d in self.diagnostics
            if d.correction is not None
            and (unsafe or d.correction.safety is FixSafety.SAFE)
        ]


@dataclass
class FixResult:
    """What one document looks like after fixing it."""

    check: CheckResult
    fixed_text: str
    applied: list[Correction] = field(default_factory=list)
    skipped: list[tuple[Correction, str]] = field(default_factory=list)

    @property
    def path(self) -> str:
        return self.check.path

    @property
    def changed(self) -> bool:
        return self.fixed_text != self.check.text

    @property
    def remaining(self) -> list[Diagnostic]:
        """Findings no fix addressed — what a human still has to look at."""
        applied_spans = {c.span for c in self.applied}
        return [
            d
            for d in self.check.diagnostics
            if d.correction is None or d.correction.span not in applied_spans
        ]

    def diff(self) -> str:
        return unified_diff(self.check.text, self.fixed_text, path=self.path)


class Engine:
    """Checks and fixes documents.

    Args:
        rules: The rules to run. Defaults to the whole registry, minus the
            verification family when ``verifier`` is ``None``.
        verifier: Supplies CourtListener results. ``None`` means offline.
        clean: ``eyecite.clean`` steps to apply before extraction. Note these
            rewrite the document, so a fix run will emit the cleaned text.
        current_year: Injectable for deterministic tests.
    """

    def __init__(
        self,
        *,
        rules: list[Rule] | None = None,
        verifier: Verifier | None = None,
        clean: tuple[str, ...] = (),
        current_year: int | None = None,
    ) -> None:
        self._verifier = verifier
        self._clean = clean
        self._current_year = current_year or _dt.date.today().year
        self._rules = (
            rules
            if rules is not None
            else select_rules(include_verification=verifier is not None)
        )

    @property
    def rules(self) -> list[Rule]:
        return self._rules

    # -- checking ---------------------------------------------------------

    def check_text(self, text: str, path: str = "<text>") -> CheckResult:
        extraction = extract(text, clean=self._clean)

        verification = None
        verifications = {}
        if self._verifier is not None:
            verification = self._verifier.verify(extraction)
            verifications = verification.results

        ctx = RuleContext(
            extraction=extraction,
            verifications=verifications,
            current_year=self._current_year,
        )

        return CheckResult(
            path=path,
            # Cleaning rewrites the text, so the extraction's copy — not the
            # argument — is what every span refers to from here on.
            text=extraction.text,
            extraction=extraction,
            diagnostics=run_rules(ctx, self._rules),
            verification=verification,
        )

    def check_file(self, path: Path | str) -> CheckResult:
        path = Path(path)
        return self.check_text(path.read_text(encoding="utf-8"), str(path))

    # -- fixing -----------------------------------------------------------

    def fix_text(
        self, text: str, path: str = "<text>", *, unsafe: bool = False
    ) -> FixResult:
        """Check ``text`` and apply the corrections we are allowed to apply.

        Safe corrections only, unless ``unsafe`` is set. See
        :class:`~recite.core.FixSafety` for what that distinction means.
        """
        check = self.check_text(text, path)
        corrections = [
            d.correction for d in check.fixable(unsafe=unsafe) if d.correction
        ]
        patch = apply_corrections(check.text, corrections)

        return FixResult(
            check=check,
            fixed_text=patch.text,
            applied=patch.applied,
            skipped=patch.skipped,
        )

    def fix_file(
        self,
        path: Path | str,
        *,
        unsafe: bool = False,
        write: bool = False,
    ) -> FixResult:
        path = Path(path)
        result = self.fix_text(
            path.read_text(encoding="utf-8"), str(path), unsafe=unsafe
        )
        if write and result.changed:
            path.write_text(result.fixed_text, encoding="utf-8")
        return result
