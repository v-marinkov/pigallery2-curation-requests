#!/usr/bin/env python3
"""Atomically configure PiGallery2 curation settings and browser asset loading."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile
from typing import Sequence


def asset_cache_tag(asset_path: Path) -> str:
    digest = hashlib.sha256()
    with asset_path.open("rb") as asset:
        while chunk := asset.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()[:12]


def custom_html_head(cache_tag: str) -> str:
    return f"""(() => {{
  if (document.getElementById('pg2-curation-custom-script')) {{
    return;
  }}

  const script = document.createElement('script');
  script.id = 'pg2-curation-custom-script';
  script.src = new URL(
    'custom-scripts.js?v={cache_tag}',
    document.baseURI
  ).href;

  document.head.appendChild(script);
}})();"""


def set_extension_settings(
    config: dict,
    folder: str,
    database_path: str,
    requester_allowlist: str,
    reason_max_length: int,
) -> bool:
    extensions_config = config.setdefault("Extensions", {})
    if not isinstance(extensions_config, dict):
        raise ValueError("Extensions in config.json is not a JSON object")
    installed = extensions_config.setdefault("extensions", {})
    if not isinstance(installed, dict):
        raise ValueError("Extensions.extensions in config.json is not a JSON object")
    entry = installed.setdefault(folder, {})
    if not isinstance(entry, dict):
        raise ValueError(f"Extensions.extensions.{folder} is not a JSON object")
    extension_config = entry.setdefault("configs", {})
    if not isinstance(extension_config, dict):
        raise ValueError(f"Extensions.extensions.{folder}.configs is not a JSON object")

    desired_entry = {"enabled": True, "path": folder}
    desired_config = {
        "databasePath": database_path,
        "reasonMaxLength": reason_max_length,
        "requesterAllowlist": requester_allowlist,
    }
    changed = any(entry.get(key) != value for key, value in desired_entry.items())
    changed = changed or any(extension_config.get(key) != value for key, value in desired_config.items())
    entry.update(desired_entry)
    extension_config.update(desired_config)
    return changed


def update_config(
    config_path: Path,
    cache_tag: str,
    extension_settings: tuple[str, str, str, int] | None = None,
) -> bool:
    if not config_path.is_file():
        raise ValueError(f"PiGallery2 config does not exist: {config_path}")
    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"invalid JSON in {config_path}: {error}") from error

    server = config.get("Server")
    if server is None:
        server = {}
        config["Server"] = server
    elif not isinstance(server, dict):
        raise ValueError(f"Server in {config_path} is not a JSON object")

    html = custom_html_head(cache_tag)
    changed = server.get("customHTMLHead") != html
    server["customHTMLHead"] = html
    if extension_settings is not None:
        changed = set_extension_settings(config, *extension_settings) or changed
    if not changed:
        return False

    original = config_path.stat()
    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        dir=config_path.parent,
        prefix=f".{config_path.name}.",
        suffix=".tmp",
        delete=False,
    ) as temporary:
        temporary_path = Path(temporary.name)
        json.dump(config, temporary, ensure_ascii=False, indent=2)
        temporary.write("\n")
        temporary.flush()
        os.fsync(temporary.fileno())

    try:
        os.chmod(temporary_path, stat.S_IMODE(original.st_mode))
        try:
            os.chown(temporary_path, original.st_uid, original.st_gid)
        except PermissionError:
            # An unprivileged owner can still safely replace their own config.
            pass
        os.replace(temporary_path, config_path)
    except BaseException:
        temporary_path.unlink(missing_ok=True)
        raise
    return True


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, type=Path, help="PiGallery2 config.json")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--asset", type=Path, help="custom-scripts.js used to calculate the cache tag")
    source.add_argument("--cache-tag", help="precalculated 12-character lowercase SHA-256 prefix")
    parser.add_argument("--extension-folder", help="PiGallery2 extension folder/config key")
    parser.add_argument("--database-path", help="curation database path as seen inside PiGallery2")
    parser.add_argument("--requester-allowlist", help="deletion request access setting")
    parser.add_argument("--reason-max-length", type=int, help="maximum optional reason length")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    if arguments.asset:
        if not arguments.asset.is_file():
            print(f"ERROR: browser asset does not exist: {arguments.asset}")
            return 2
        cache_tag = asset_cache_tag(arguments.asset)
    else:
        cache_tag = arguments.cache_tag
        if len(cache_tag) != 12 or any(character not in "0123456789abcdef" for character in cache_tag):
            print("ERROR: --cache-tag must be a 12-character lowercase hexadecimal value")
            return 2

    extension_values = (
        arguments.extension_folder,
        arguments.database_path,
        arguments.requester_allowlist,
        arguments.reason_max_length,
    )
    provided_extension_values = [value is not None for value in extension_values]
    if any(provided_extension_values) and not all(provided_extension_values):
        print("ERROR: all four extension-setting arguments must be supplied together")
        return 2
    if arguments.reason_max_length is not None and arguments.reason_max_length < 1:
        print("ERROR: --reason-max-length must be positive")
        return 2

    try:
        changed = update_config(
            arguments.config,
            cache_tag,
            extension_values if all(provided_extension_values) else None,
        )
    except (OSError, ValueError) as error:
        print(f"ERROR: {error}")
        return 2

    action = "Set" if changed else "Already configured"
    print(f"{action}: Server.customHTMLHead cache tag {cache_tag}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
