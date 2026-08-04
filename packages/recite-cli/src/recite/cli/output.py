"""Rendering check results as text, JSON or SARIF."""

from __future__ import annotations

import json
from typing import Any

from rich.console import Console
from rich.text import Text

from recite.core import Diagnostic, FixSafety, Severity, line_col, snippet
from recite.fix import CheckResult

__all__ = ["FORMATS", "render"]

FORMATS = ("text", "json", "sarif")

_SEVERITY_STYLE = {
    Severity.ERROR: "bold red",
    Severity.WARNING: "yellow",
    Severity.INFO: "cyan",
}

#: SARIF only has error/warning/note, so INFO maps onto note.
_SARIF_LEVEL = {
    Severity.ERROR: "error",
    Severity.WARNING: "warning",
    Severity.INFO: "note",
}


def render(
    results: list[CheckResult],
    fmt: str,
    console: Console,
    *,
    show_snippets: bool = True,
) -> None:
    if fmt == "json":
        console.print_json(json.dumps(_as_json(results)))
    elif fmt == "sarif":
        # Printed raw: SARIF is consumed by tools, so it must not be wrapped
        # or syntax-coloured.
        print(json.dumps(_as_sarif(results), indent=2))
    else:
        _as_text(results, console, show_snippets=show_snippets)


# ---------------------------------------------------------------- text ----


def _as_text(
    results: list[CheckResult], console: Console, *, show_snippets: bool
) -> None:
    total = dict.fromkeys(Severity, 0)

    for result in results:
        if result.ok:
            console.print(f"[green]✓[/green] {result.path} — no problems found")
            continue

        console.print(f"\n[bold]{result.path}[/bold]")
        for diagnostic in result.diagnostics:
            total[diagnostic.severity] += 1
            _print_diagnostic(console, result, diagnostic, show_snippets)

    _print_summary(console, results, total)


def _print_diagnostic(
    console: Console,
    result: CheckResult,
    diagnostic: Diagnostic,
    show_snippets: bool,
) -> None:
    line, column = line_col(result.text, diagnostic.span.start)
    style = _SEVERITY_STYLE[diagnostic.severity]

    header = Text()
    header.append(f"  {line}:{column}", style="dim")
    header.append(f"  {diagnostic.severity.value:<8}", style=style)
    header.append(f"{diagnostic.rule_id}  ", style="dim")
    header.append(diagnostic.message)
    console.print(header)

    if show_snippets:
        console.print(
            f"      [dim]{snippet(result.text, diagnostic.span)}[/dim]",
            highlight=False,
        )

    correction = diagnostic.correction
    if correction is not None:
        marker = "fix" if correction.safety is FixSafety.SAFE else "fix (unsafe)"
        console.print(
            f"      [green]{marker}:[/green] "
            f"[dim]{correction.span.slice_of(result.text)!r} → "
            f"{correction.replacement!r}[/dim]",
            highlight=False,
        )


def _print_summary(
    console: Console, results: list[CheckResult], total: dict[Severity, int]
) -> None:
    if not any(total.values()):
        return

    parts = [
        f"[{_SEVERITY_STYLE[sev]}]{total[sev]} {sev.value}"
        f"{'s' if total[sev] != 1 else ''}[/]"
        for sev in (Severity.ERROR, Severity.WARNING, Severity.INFO)
        if total[sev]
    ]
    citations = sum(len(r.extraction.citations) for r in results)
    console.print(
        f"\n{', '.join(parts)} across {citations} citation"
        f"{'s' if citations != 1 else ''} in {len(results)} file"
        f"{'s' if len(results) != 1 else ''}."
    )

    fixable = sum(len(r.fixable()) for r in results)
    unsafe = sum(len(r.fixable(unsafe=True)) for r in results) - fixable
    if fixable or unsafe:
        hints = []
        if fixable:
            hints.append(f"{fixable} fixable with [bold]recite fix[/bold]")
        if unsafe:
            hints.append(f"{unsafe} more with [bold]--unsafe[/bold] (review these)")
        console.print(f"[dim]{'; '.join(hints)}.[/dim]")


# ---------------------------------------------------------------- json ----


def _as_json(results: list[CheckResult]) -> list[dict[str, Any]]:
    return [
        {
            "path": result.path,
            "citations": [c.to_dict() for c in result.extraction.citations],
            "diagnostics": [_diagnostic_json(result, d) for d in result.diagnostics],
            "summary": {
                severity.value: count for severity, count in result.counts().items()
            },
            "verification": None
            if result.verification is None
            else {
                "verified": result.verification.verified,
                "requests_made": result.verification.requests_made,
                "cache_hits": result.verification.cache_hits,
            },
        }
        for result in results
    ]


def _diagnostic_json(result: CheckResult, diagnostic: Diagnostic) -> dict[str, Any]:
    line, column = line_col(result.text, diagnostic.span.start)
    payload: dict[str, Any] = {
        "rule": diagnostic.rule_id,
        "severity": diagnostic.severity.value,
        "message": diagnostic.message,
        "line": line,
        "column": column,
        "span": list(diagnostic.span.as_tuple()),
        "citation": diagnostic.citation_text,
        "context": diagnostic.context,
    }
    if diagnostic.correction is not None:
        payload["fix"] = {
            "span": list(diagnostic.correction.span.as_tuple()),
            "replacement": diagnostic.correction.replacement,
            "safety": diagnostic.correction.safety.value,
            "description": diagnostic.correction.description,
        }
    return payload


# --------------------------------------------------------------- sarif ----


def _as_sarif(results: list[CheckResult]) -> dict[str, Any]:
    """SARIF 2.1.0, so `recite check` can annotate a pull request directly."""
    from recite.rules import all_rules

    return {
        "$schema": "https://json.schemastore.org/sarif-2.1.0.json",
        "version": "2.1.0",
        "runs": [
            {
                "tool": {
                    "driver": {
                        "name": "ReCite",
                        "informationUri": "https://github.com/wbarnha/ReCite",
                        "rules": [
                            {
                                "id": rule.id,
                                "name": rule.name,
                                "shortDescription": {"text": rule.summary},
                                "defaultConfiguration": {
                                    "level": _SARIF_LEVEL[rule.severity]
                                },
                            }
                            for rule in all_rules()
                        ],
                    }
                },
                "results": [
                    _sarif_result(result, diagnostic)
                    for result in results
                    for diagnostic in result.diagnostics
                ],
            }
        ],
    }


def _sarif_result(result: CheckResult, diagnostic: Diagnostic) -> dict[str, Any]:
    start_line, start_column = line_col(result.text, diagnostic.span.start)
    end_line, end_column = line_col(result.text, diagnostic.span.end)

    return {
        "ruleId": diagnostic.rule_id,
        "level": _SARIF_LEVEL[diagnostic.severity],
        "message": {"text": diagnostic.message},
        "locations": [
            {
                "physicalLocation": {
                    "artifactLocation": {"uri": result.path},
                    "region": {
                        "startLine": start_line,
                        "startColumn": start_column,
                        "endLine": end_line,
                        "endColumn": end_column,
                        "snippet": {"text": diagnostic.citation_text},
                    },
                }
            }
        ],
    }
