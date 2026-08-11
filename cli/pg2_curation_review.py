#!/usr/bin/env python3
"""Inspect PiGallery2 curation requests from the trusted host."""

from __future__ import annotations

import argparse
import os
import re
import sqlite3
import sys
from pathlib import Path
from typing import Sequence


STATES = (
    "ACTIVE",
    "PENDING",
    "APPROVED",
    "DECLINED",
    "EXECUTED",
    "ERROR",
    "OPEN",
    "RESOLVED",
    "DISMISSED",
    "WITHDRAWN",
    "ALL",
)


def load_local_env() -> dict[str, str]:
    """Load a small, non-executable .env file from cwd or the script directory."""
    candidates = [Path.cwd() / ".env", Path(__file__).resolve().parent / ".env"]
    result: dict[str, str] = {}
    seen: set[Path] = set()
    for candidate in candidates:
        candidate = candidate.resolve()
        if candidate in seen or not candidate.is_file():
            continue
        seen.add(candidate)
        for line_number, raw_line in enumerate(candidate.read_text(encoding="utf-8").splitlines(), start=1):
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("export "):
                line = line[7:].lstrip()
            if "=" not in line:
                raise ValueError(f"{candidate}:{line_number}: expected KEY=VALUE")
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip()
            if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
                raise ValueError(f"{candidate}:{line_number}: invalid setting name")
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
                value = value[1:-1]
            result.setdefault(key, value)
        break
    return result


def configured_value(local_env: dict[str, str], key: str, fallback: str | None = None) -> str | None:
    return os.environ.get(key) or local_env.get(key) or fallback


def run(database: Path, state: str) -> int:
    if not database.is_file():
        print(f"ERROR: curation database does not exist: {database}", file=sys.stderr)
        return 2
    connection = sqlite3.connect(f"file:{database.resolve()}?mode=ro", uri=True, timeout=5)
    connection.row_factory = sqlite3.Row
    if state == "ALL":
        where = ""
        parameters: tuple[str, ...] = ()
    elif state == "ACTIVE":
        where = "WHERE state IN ('PENDING', 'APPROVED')"
        parameters = ()
    elif state in ("OPEN", "RESOLVED", "DISMISSED", "WITHDRAWN"):
        where = "WHERE 0"
        parameters = ()
    else:
        where = "WHERE state = ?"
        parameters = (state,)
    try:
        items = connection.execute(
            f"""
            SELECT id, relative_path, state, current_cycle, created_at, updated_at,
                   approved_by_user_name, approved_at, declined_by_user_name, declined_at,
                   executed_at, execution_error
              FROM deletion_items
              {where}
             ORDER BY CASE state WHEN 'PENDING' THEN 0 WHEN 'APPROVED' THEN 1 ELSE 2 END,
                      updated_at, relative_path
            """,
            parameters,
        ).fetchall()
    except sqlite3.DatabaseError as exc:
        print(f"ERROR: invalid or unavailable curation database: {exc}", file=sys.stderr)
        connection.close()
        return 2

    print(f"DELETION REQUESTS: {state}")
    print("=" * 72)
    for item in items:
        print(item["relative_path"])
        print(f'  State:       {item["state"]} (cycle {item["current_cycle"]})')
        print(f'  Updated:     {item["updated_at"]}')
        requests = connection.execute(
            """
            SELECT requested_by_user_name, requested_at, reason, withdrawn_at
              FROM deletion_requests
             WHERE deletion_item_id = ? AND cycle = ?
             ORDER BY requested_at, id
            """,
            (item["id"], item["current_cycle"]),
        ).fetchall()
        print("  Requests:")
        for request in requests:
            withdrawn = " (withdrawn)" if request["withdrawn_at"] else ""
            reason = f' — "{request["reason"]}"' if request["reason"] else ""
            print(f'    {request["requested_by_user_name"]} @ {request["requested_at"]}{withdrawn}{reason}')
        if item["approved_at"]:
            print(f'  Approved:    {item["approved_by_user_name"]} @ {item["approved_at"]}')
        cancellation = connection.execute(
            """
            SELECT actor_user_name, created_at
              FROM curation_events
             WHERE deletion_item_id = ? AND cycle = ? AND event_type = 'DELETION_CANCELLED'
             ORDER BY id DESC
             LIMIT 1
            """,
            (item["id"], item["current_cycle"]),
        ).fetchone()
        if cancellation:
            print(f'  Cancelled:   {cancellation["actor_user_name"]} @ {cancellation["created_at"]}')
        elif item["declined_at"]:
            print(f'  Declined:    {item["declined_by_user_name"]} @ {item["declined_at"]}')
        if item["executed_at"]:
            print(f'  Executed:    {item["executed_at"]}')
        if item["execution_error"]:
            print(f'  Error:       {item["execution_error"]}')
        print("-" * 72)
    print(f"{len(items)} deletion item(s)")

    has_metadata_requests = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'metadata_requests'"
    ).fetchone() is not None
    if has_metadata_requests:
        if state == "ALL":
            metadata_where = ""
            metadata_parameters: tuple[str, ...] = ()
        elif state == "ACTIVE":
            metadata_where = "WHERE mr.state = 'OPEN'"
            metadata_parameters = ()
        elif state in ("OPEN", "RESOLVED", "DISMISSED", "WITHDRAWN"):
            metadata_where = "WHERE mr.state = ?"
            metadata_parameters = (state,)
        else:
            metadata_where = "WHERE 0"
            metadata_parameters = ()
        metadata_requests = connection.execute(
            f"""
            SELECT cm.relative_path, mr.category, mr.state,
                   mr.requested_by_user_name, mr.requested_at, mr.comment,
                   mr.updated_at, mr.closed_by_user_name, mr.closed_at,
                   mr.resolution_comment
              FROM metadata_requests mr
              JOIN curation_media cm ON cm.id = mr.curation_media_id
              {metadata_where}
             ORDER BY CASE mr.state WHEN 'OPEN' THEN 0 ELSE 1 END,
                      mr.updated_at, cm.relative_path, mr.category, mr.id
            """,
            metadata_parameters,
        ).fetchall()
        print()
        print(f"METADATA REQUESTS: {state}")
        print("=" * 72)
        for request in metadata_requests:
            print(request["relative_path"])
            print(f'  Category:    {request["category"]}')
            print(f'  State:       {request["state"]}')
            print(f'  Requested:   {request["requested_by_user_name"]} @ {request["requested_at"]}')
            if request["comment"]:
                print(f'  Comment:     "{request["comment"]}"')
            if request["closed_at"]:
                print(f'  Closed:      {request["closed_by_user_name"]} @ {request["closed_at"]}')
            if request["resolution_comment"]:
                print(f'  Resolution:  "{request["resolution_comment"]}"')
            print("-" * 72)
        print(f"{len(metadata_requests)} metadata request(s)")
    connection.close()
    return 0


def build_parser() -> argparse.ArgumentParser:
    local_env = load_local_env()
    configured_database = configured_value(local_env, "PG2_CURATION_DB")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--database",
        type=Path,
        default=Path(configured_database) if configured_database else None,
        required=configured_database is None,
        help="curation.sqlite path (overrides PG2_CURATION_DB from the environment or local .env)",
    )
    parser.add_argument(
        "--state",
        choices=STATES,
        default="ACTIVE",
        help="workflow state to show; ACTIVE includes pending/approved deletions and open metadata requests",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    try:
        parser = build_parser()
    except (OSError, ValueError) as exc:
        print(f"ERROR: invalid local .env configuration: {exc}", file=sys.stderr)
        return 2
    arguments = parser.parse_args(argv)
    return run(arguments.database, arguments.state)


if __name__ == "__main__":
    raise SystemExit(main())
