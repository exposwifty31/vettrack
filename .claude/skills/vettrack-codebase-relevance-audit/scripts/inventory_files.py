#!/usr/bin/env python3
"""Create a deterministic file inventory for VetTrack relevance audits."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
from pathlib import Path


DEFAULT_SKIP_DIRS = {
    ".git",
    "node_modules",
    "dist",
    "coverage",
    ".turbo",
    ".vite",
    ".next",
    ".cache",
}


def run_git(root: Path, args: list[str]) -> set[str]:
    result = subprocess.run(
        ["git", *args],
        cwd=root,
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    if result.returncode != 0:
        return set()
    return {line.strip() for line in result.stdout.splitlines() if line.strip()}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def iter_files(root: Path, include_ignored: bool) -> list[Path]:
    files: list[Path] = []
    for current_root, dirs, names in os.walk(root):
        if not include_ignored:
            dirs[:] = [d for d in dirs if d not in DEFAULT_SKIP_DIRS]
        else:
            dirs[:] = [d for d in dirs if d != ".git"]
        for name in names:
            path = Path(current_root) / name
            if path.is_file():
                files.append(path.relative_to(root))
    return sorted(files, key=lambda p: p.as_posix())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=".", help="Repository root to inventory")
    parser.add_argument("--output", help="Write JSON inventory to this path")
    parser.add_argument(
        "--include-ignored",
        action="store_true",
        help="Include ignored/cache directories except .git",
    )
    args = parser.parse_args()

    root = Path(args.root).resolve()
    tracked = run_git(root, ["ls-files"])
    modified = run_git(root, ["ls-files", "--modified"])
    deleted = run_git(root, ["ls-files", "--deleted"])
    others = run_git(root, ["ls-files", "--others", "--exclude-standard"])
    ignored = run_git(root, ["ls-files", "--others", "--ignored", "--exclude-standard"])

    records = []
    for rel_path in iter_files(root, args.include_ignored):
        rel = rel_path.as_posix()
        full_path = root / rel_path
        stat = full_path.stat()
        records.append(
            {
                "path": rel,
                "size_bytes": stat.st_size,
                "sha256": sha256(full_path),
                "tracked": rel in tracked,
                "modified": rel in modified,
                "deleted_in_index": rel in deleted,
                "untracked": rel in others,
                "ignored": rel in ignored,
                "extension": full_path.suffix,
            }
        )

    payload = {
        "root": str(root),
        "file_count": len(records),
        "records": records,
    }

    text = json.dumps(payload, indent=2, sort_keys=True)
    if args.output:
        Path(args.output).write_text(text + "\n", encoding="utf-8")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
