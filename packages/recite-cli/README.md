# recite-cli

The `recite` command.

```console
$ recite check brief.txt
$ recite fix brief.txt --write
$ recite check brief.txt --verify --format sarif > recite.sarif
```

| Command | Purpose |
| --- | --- |
| `recite check PATH...` | Report problems. Exits 1 on any error-level finding. |
| `recite fix PATH...` | Correct citations; prints a diff, `--write` edits in place. |
| `recite extract PATH...` | Dump every citation as JSON. |
| `recite lookup CITE` | Ask CourtListener what a citation refers to. |
| `recite rules [ID]` | List the rule set, or explain one rule. |
| `recite info reporter F.3d` | Show a reporter series and its date ranges. |
| `recite info court ca9` | Show what a `courts-db` id means. |
| `recite cache [--clear]` | Inspect or clear the lookup cache. |

`-` reads from stdin, so `recite` composes with everything else:

```console
$ pdftotext brief.pdf - | recite check -
$ cat brief.txt | recite fix - --write > fixed.txt
```

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | no error-level findings (warnings and notes may still be present) |
| `1` | at least one error-level finding |
| `2` | bad usage, unreadable file, or the API refused the token |

## Environment

| Variable | Effect |
| --- | --- |
| `COURTLISTENER_API_TOKEN` | Enables `--verify` and `recite lookup`. |
| `RECITE_OFFLINE` | Forces every run offline, whatever the flags say. |
