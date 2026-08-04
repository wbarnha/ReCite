"""The ``recite`` command line interface."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Annotated, NoReturn

import typer
from rich.console import Console
from rich.table import Table

from recite.core import court_citation_string, court_info, extract, series_editions
from recite.fix import CheckResult, Engine
from recite.rules import all_rules, get_rule, select_rules
from recite.verify import (
    TOKEN_ENV_VAR,
    CourtListenerClient,
    CourtListenerError,
    LookupCache,
    Verifier,
)

from .output import FORMATS, render

app = typer.Typer(
    name="recite",
    help="Find and fix case law citations, using Free Law Project data.",
    no_args_is_help=True,
    add_completion=False,
)

console = Console()
err_console = Console(stderr=True)

#: Set by CI and by anyone who wants a guaranteed-offline run.
OFFLINE_ENV_VAR = "RECITE_OFFLINE"

# Exit codes: 0 clean, 1 errors found, 2 usage or runtime failure.
EXIT_OK = 0
EXIT_FINDINGS = 1
EXIT_FAILURE = 2


# --------------------------------------------------------------- options ---

PathsArg = Annotated[
    list[Path],
    typer.Argument(
        help="Files to check. Use '-' to read from stdin.",
        show_default=False,
    ),
]
FormatOpt = Annotated[
    str,
    typer.Option("--format", "-f", help=f"Output format: {', '.join(FORMATS)}."),
]
VerifyOpt = Annotated[
    bool,
    typer.Option(
        "--verify/--offline",
        help="Cross-check citations against CourtListener (needs an API token).",
    ),
]
SelectOpt = Annotated[
    list[str] | None,
    typer.Option("--select", "-s", help="Only run these rules (id or name)."),
]
IgnoreOpt = Annotated[
    list[str] | None,
    typer.Option("--ignore", "-i", help="Skip these rules (id or name)."),
]


# --------------------------------------------------------------- helpers ---


def _fail(message: str) -> NoReturn:
    """Report a usage or runtime problem and exit 2."""
    err_console.print(f"[bold red]error:[/bold red] {message}")
    raise typer.Exit(EXIT_FAILURE)


def _read(path: Path) -> tuple[str, str]:
    """``(text, display_path)``, handling ``-`` as stdin."""
    if str(path) == "-":
        return sys.stdin.read(), "<stdin>"
    try:
        return path.read_text(encoding="utf-8"), str(path)
    except OSError as exc:
        _fail(f"could not read {path}: {exc}")


def _validate_rule_names(names: list[str] | None) -> None:
    for name in names or []:
        if get_rule(name) is None:
            _fail(f"unknown rule {name!r}. Run `recite rules` to see them all.")


def _build_engine(
    *,
    verify: bool,
    select: list[str] | None,
    ignore: list[str] | None,
    no_cache: bool = False,
) -> Engine:
    _validate_rule_names(select)
    _validate_rule_names(ignore)

    if os.environ.get(OFFLINE_ENV_VAR):
        verify = False

    verifier = None
    if verify:
        try:
            client = CourtListenerClient()
        except CourtListenerError as exc:
            _fail(str(exc))
        verifier = Verifier(client, cache=None if no_cache else LookupCache())

    rules = select_rules(
        enable=select,
        disable=ignore,
        include_verification=verifier is not None,
    )
    if not rules:
        _fail("no rules selected")

    return Engine(rules=rules, verifier=verifier)


def _exit_code(results: list[CheckResult]) -> int:
    return EXIT_FINDINGS if any(r.error_count for r in results) else EXIT_OK


# -------------------------------------------------------------- commands ---


@app.command()
def check(
    paths: PathsArg,
    fmt: FormatOpt = "text",
    verify: VerifyOpt = False,
    select: SelectOpt = None,
    ignore: IgnoreOpt = None,
    no_snippets: Annotated[
        bool, typer.Option("--no-snippets", help="Omit surrounding text.")
    ] = False,
) -> None:
    """Report citation problems without changing anything.

    Exits 1 when any error-level finding is present, so it can gate a build.
    Warnings and style notes on their own exit 0.
    """
    if fmt not in FORMATS:
        _fail(f"unknown format {fmt!r}. Choose from: {', '.join(FORMATS)}.")

    engine = _build_engine(verify=verify, select=select, ignore=ignore)

    results = []
    for path in paths:
        text, display = _read(path)
        results.append(engine.check_text(text, display))

    render(results, fmt, console, show_snippets=not no_snippets)
    raise typer.Exit(_exit_code(results))


@app.command()
def fix(
    paths: PathsArg,
    write: Annotated[
        bool,
        typer.Option(
            "--write/--diff", "-w", help="Edit files in place, or show a diff."
        ),
    ] = False,
    unsafe: Annotated[
        bool,
        typer.Option(
            "--unsafe",
            help="Also apply fixes that change which authority is cited. Review them.",
        ),
    ] = False,
    verify: VerifyOpt = False,
    select: SelectOpt = None,
    ignore: IgnoreOpt = None,
) -> None:
    """Correct citations, printing a diff by default and writing with --write.

    Only formatting fixes are applied unless ``--unsafe`` is given, because a
    confidently wrong citation is worse than a visibly broken one.
    """
    engine = _build_engine(verify=verify, select=select, ignore=ignore)

    changed_files = 0
    total_applied = 0
    remaining = []
    streamed_to_stdout = False

    for path in paths:
        text, display = _read(path)
        result = engine.fix_text(text, display, unsafe=unsafe)
        total_applied += len(result.applied)
        remaining.append(result.check)

        if write and display == "<stdin>":
            # stdin has no file to write back to, so the document goes to
            # stdout. It is emitted whether or not anything changed: a
            # `recite fix - --write > out.txt` that printed nothing for an
            # already-clean brief would silently truncate it to nothing.
            print(result.fixed_text, end="")
            streamed_to_stdout = True
        elif not result.changed:
            continue
        elif write:
            Path(display).write_text(result.fixed_text, encoding="utf-8")
            console.print(
                f"[green]fixed[/green] {display} "
                f"({len(result.applied)} correction"
                f"{'s' if len(result.applied) != 1 else ''})"
            )
        else:
            console.print(result.diff(), highlight=False, markup=False, end="")

        if result.changed:
            changed_files += 1

        for correction, reason in result.skipped:
            err_console.print(
                f"[yellow]skipped[/yellow] {display} "
                f"{correction.span.as_tuple()}: {reason}"
            )

    if write:
        # The document itself may be on stdout, so the summary must not be —
        # otherwise `recite fix - --write > out.txt` corrupts the output.
        summary = err_console if streamed_to_stdout else console
        summary.print(
            f"\n{total_applied} correction{'s' if total_applied != 1 else ''} "
            f"across {changed_files} file{'s' if changed_files != 1 else ''}."
        )
        if not unsafe:
            extra = sum(
                len(c.fixable(unsafe=True)) - len(c.fixable()) for c in remaining
            )
            if extra:
                summary.print(
                    f"[dim]{extra} further fix{'es' if extra != 1 else ''} need "
                    f"review; re-run with --unsafe to apply them.[/dim]"
                )

    raise typer.Exit(_exit_code(remaining))


@app.command("extract")
def extract_command(
    paths: PathsArg,
    resolved: Annotated[
        bool,
        typer.Option("--resolved", help="Group citations by the case they refer to."),
    ] = False,
) -> None:
    """Dump every citation found, as JSON. Useful for piping into other tools."""
    payload = []
    for path in paths:
        text, display = _read(path)
        extraction = extract(text)
        entry: dict[str, object] = {
            "path": display,
            "citations": [c.to_dict() for c in extraction.citations],
        }
        if resolved:
            entry["resources"] = extraction.resources
        payload.append(entry)

    print(json.dumps(payload, indent=2))


@app.command()
def lookup(
    citation: Annotated[
        str, typer.Argument(help="A citation, e.g. '410 U.S. 113'.", show_default=False)
    ],
    no_cache: Annotated[
        bool, typer.Option("--no-cache", help="Bypass the local cache.")
    ] = False,
) -> None:
    """Ask CourtListener what case a citation refers to."""
    if os.environ.get(OFFLINE_ENV_VAR):
        _fail(f"${OFFLINE_ENV_VAR} is set, so no lookup was attempted.")

    try:
        client = CourtListenerClient()
    except CourtListenerError as exc:
        _fail(str(exc))

    engine = Engine(
        verifier=Verifier(client, cache=None if no_cache else LookupCache())
    )
    try:
        result = engine.check_text(citation, "<argument>")
    except CourtListenerError as exc:
        _fail(str(exc))
    finally:
        client.close()

    if not result.extraction.citations:
        _fail(f"{citation!r} does not parse as a citation.")

    verification = result.verification
    results = verification.results if verification else {}
    if not results:
        console.print("[yellow]No result returned for that citation.[/yellow]")
        raise typer.Exit(EXIT_FINDINGS)

    for parsed in result.extraction.citations:
        found = results.get(parsed.index)
        if found is None:
            continue
        console.print(f"[bold]{parsed.corrected}[/bold]  (status {found.status})")
        if not found.clusters:
            console.print("  [red]no matching case[/red]")
        for cluster in found.clusters:
            console.print(f"  {cluster.case_name or '(unnamed)'}")
            console.print(f"    [dim]decided[/dim] {cluster.date_filed or 'unknown'}")
            if cluster.citations:
                console.print(f"    [dim]cited as[/dim] {', '.join(cluster.citations)}")
            if cluster.url:
                console.print(f"    [dim]{cluster.url}[/dim]")


@app.command()
def rules(
    rule_id: Annotated[
        str | None,
        typer.Argument(help="Show detail for one rule.", show_default=False),
    ] = None,
) -> None:
    """List the rule set, or explain one rule."""
    if rule_id is not None:
        rule = get_rule(rule_id)
        if rule is None:
            _fail(f"unknown rule {rule_id!r}")
        console.print(f"[bold]{rule.id}[/bold]  {rule.name}")
        console.print(f"  severity: {rule.severity.value}")
        console.print(
            f"  network:  {'required' if rule.requires_verification else 'no'}"
        )
        console.print(f"\n  {rule.summary}")
        if rule.__doc__:
            console.print()
            for line in rule.__doc__.strip().splitlines():
                console.print(f"  [dim]{line.strip()}[/dim]")
        return

    table = Table(title="ReCite rules")
    table.add_column("ID", style="bold")
    table.add_column("Name")
    table.add_column("Severity")
    table.add_column("Net", justify="center")
    table.add_column("Checks")

    for rule in all_rules():
        table.add_row(
            rule.id,
            rule.name,
            rule.severity.value,
            "•" if rule.requires_verification else "",
            rule.summary,
        )

    console.print(table)
    console.print(
        "[dim]• marks rules that need CourtListener; run `recite check --verify`.[/dim]"
    )


info_app = typer.Typer(help="Look things up in the Free Law Project databases.")
app.add_typer(info_app, name="info")


@info_app.command("reporter")
def info_reporter(
    name: Annotated[
        str, typer.Argument(help="A reporter edition, e.g. 'F.3d'.", show_default=False)
    ],
) -> None:
    """Show a reporter series and the years each edition covers."""
    editions = series_editions(name)
    if not editions:
        _fail(f"{name!r} is not a known reporter. Try `recite check` on the text.")

    table = Table(title=f"{editions[0].reporter_name} ({editions[0].cite_type})")
    table.add_column("Edition", style="bold")
    table.add_column("Years")

    for edition in editions:
        style = "bold" if edition.name == name else None
        table.add_row(edition.name, edition.coverage_label(), style=style)

    console.print(table)


@info_app.command("court")
def info_court(
    identifier: Annotated[
        str,
        typer.Argument(help="A courts-db id, e.g. 'ca9'.", show_default=False),
    ],
) -> None:
    """Show what a courts-db court id means."""
    court = court_info(identifier)
    if court is None:
        _fail(f"{identifier!r} is not a known courts-db id.")

    console.print(f"[bold]{court.id}[/bold]  {court.name}")
    console.print(f"  cite as: {court_citation_string(court.id) or '(none)'}")
    console.print(f"  type:    {court.type or 'unknown'}")
    console.print(f"  active:  {court.lifespan_label()}")


@app.command("cache")
def cache_command(
    clear: Annotated[
        bool, typer.Option("--clear", help="Delete every cached lookup.")
    ] = False,
) -> None:
    """Inspect or clear the local CourtListener lookup cache."""
    store = LookupCache()
    if clear:
        console.print(f"Cleared {store.clear()} cached lookups from {store.path}.")
    else:
        console.print(f"{len(store)} cached lookups in {store.path}.")


@app.command()
def version() -> None:
    """Print component versions."""
    import recite.core
    import recite.fix
    import recite.rules
    import recite.verify

    console.print(f"recite-cli    {_cli_version()}")
    console.print(f"recite-core   {recite.core.__version__}")
    console.print(f"recite-rules  {recite.rules.__version__}")
    console.print(f"recite-verify {recite.verify.__version__}")
    console.print(f"recite-fix    {recite.fix.__version__}")
    console.print(
        f"\n[dim]token: ${TOKEN_ENV_VAR} "
        f"{'set' if os.environ.get(TOKEN_ENV_VAR) else 'not set'}[/dim]"
    )


def _cli_version() -> str:
    from . import __version__

    return __version__


if __name__ == "__main__":  # pragma: no cover
    app()
