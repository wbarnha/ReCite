"""A local SQLite cache for citation lookups.

Checking a brief is an iterative loop — check, fix, check again — and the set
of citations barely changes between runs. Caching by canonical citation string
keeps the second and later runs off the network entirely, which matters because
the CourtListener API is rate limited and shared by everyone.

Entries are keyed on the canonical ``"410 U.S. 113"`` form, so a document that
spells a citation three different ways still costs one lookup.
"""

from __future__ import annotations

import json
import sqlite3
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from recite.core import CitationVerification, VerifiedCluster

__all__ = ["DEFAULT_CACHE_PATH", "DEFAULT_TTL_SECONDS", "LookupCache"]

DEFAULT_CACHE_PATH = Path.home() / ".cache" / "recite" / "lookups.sqlite3"

#: Reported case metadata is effectively immutable, but a "not found" can
#: become a "found" as CourtListener ingests more opinions, so entries expire.
DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60

_SCHEMA = """
CREATE TABLE IF NOT EXISTS lookups (
    key        TEXT PRIMARY KEY,
    status     INTEGER NOT NULL,
    payload    TEXT NOT NULL,
    fetched_at REAL NOT NULL
);
"""


class LookupCache:
    """Key/value store of citation-lookup results, backed by SQLite."""

    def __init__(
        self,
        path: Path | str | None = None,
        *,
        ttl_seconds: float = DEFAULT_TTL_SECONDS,
    ) -> None:
        self.path = Path(path) if path is not None else DEFAULT_CACHE_PATH
        self.ttl_seconds = ttl_seconds
        self._ensure_schema()

    def _ensure_schema(self) -> None:
        if self.path != Path(":memory:"):
            self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as conn:
            conn.executescript(_SCHEMA)

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path)
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    # -- reads ------------------------------------------------------------

    def get(self, key: str, citation_index: int) -> CitationVerification | None:
        """Return a cached result for ``key``, or ``None`` if absent or stale."""
        with self._connect() as conn:
            row = conn.execute(
                "SELECT status, payload, fetched_at FROM lookups WHERE key = ?",
                (key,),
            ).fetchone()

        if row is None:
            return None

        status, payload, fetched_at = row
        if time.time() - fetched_at > self.ttl_seconds:
            return None

        try:
            data = json.loads(payload)
        except json.JSONDecodeError:  # pragma: no cover - corrupt row
            return None

        return CitationVerification(
            citation_index=citation_index,
            status=int(status),
            normalized=tuple(data.get("normalized", ())),
            clusters=tuple(_to_cluster(entry) for entry in data.get("clusters", [])),
            error_message=data.get("error_message"),
            from_cache=True,
        )

    # -- writes -----------------------------------------------------------

    def put(self, key: str, result: CitationVerification) -> None:
        payload = json.dumps(
            {
                "normalized": list(result.normalized),
                "clusters": [
                    {
                        "cluster_id": c.cluster_id,
                        "case_name": c.case_name,
                        "date_filed": c.date_filed,
                        "absolute_url": c.absolute_url,
                        "citations": list(c.citations),
                    }
                    for c in result.clusters
                ],
                "error_message": result.error_message,
            }
        )
        with self._connect() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO lookups (key, status, payload, fetched_at) "
                "VALUES (?, ?, ?, ?)",
                (key, result.status, payload, time.time()),
            )

    def clear(self) -> int:
        """Drop every entry, returning how many were removed."""
        with self._connect() as conn:
            count = conn.execute("SELECT COUNT(*) FROM lookups").fetchone()[0]
            conn.execute("DELETE FROM lookups")
        return int(count)

    def __len__(self) -> int:
        with self._connect() as conn:
            return int(conn.execute("SELECT COUNT(*) FROM lookups").fetchone()[0])


def _to_cluster(entry: dict[str, Any]) -> VerifiedCluster:
    """Rebuild a cluster from a cached row.

    Fields are read one at a time rather than splatted, so a row written by an
    older (or newer) version of ReCite loads instead of raising: unknown keys
    are ignored and missing ones fall back to the dataclass defaults.
    """
    citations = entry.get("citations")
    return VerifiedCluster(
        cluster_id=entry.get("cluster_id"),
        case_name=entry.get("case_name"),
        date_filed=entry.get("date_filed"),
        absolute_url=entry.get("absolute_url"),
        citations=tuple(citations) if isinstance(citations, list) else (),
    )
