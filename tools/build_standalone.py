#!/usr/bin/env python3
"""Fold the whole game into one self-contained HTML file.

The game already runs from a plain folder, but a single file is easier to
live with: you can email it, drop it on a USB stick, put it in Dropbox, or
open it straight from Downloads on a tablet with nothing else alongside it.

Usage
    python3 tools/build_standalone.py

Output
    wordbuilder.html   (about 1.3 MB, no external files, no network)
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "index.html"
OUT_PATH = ROOT / "wordbuilder.html"

STYLESHEET = re.compile(r'[ \t]*<link rel="stylesheet" href="([^"]+)">\n?')
SCRIPT = re.compile(r'[ \t]*<script src="([^"]+)"></script>\n?')
PRELOAD = re.compile(r'[ \t]*<link rel="preload"[^>]*>\n?')


def read_asset(reference: str) -> str:
    path = ROOT / reference
    if not path.exists():
        sys.exit(f"missing {path}")
    text = path.read_text(encoding="utf-8")
    # A literal </script> inside inlined JavaScript would close the tag early.
    # Nothing in this project contains one, but a build step that silently
    # produces a broken file is worse than one that stops.
    if "</script>" in text.lower():
        sys.exit(f"{reference} contains a literal </script> and cannot be inlined")
    return text


def build() -> None:
    html = SOURCE.read_text(encoding="utf-8")

    # The preload only helps when the script is a separate request.
    html = PRELOAD.sub("", html)

    def inline_style(match: re.Match[str]) -> str:
        return "<style>\n" + read_asset(match.group(1)) + "</style>\n"

    def inline_script(match: re.Match[str]) -> str:
        return "<script>\n" + read_asset(match.group(1)) + "</script>\n"

    html, styles = STYLESHEET.subn(inline_style, html)
    html, scripts = SCRIPT.subn(inline_script, html)

    if not styles or not scripts:
        sys.exit("found no assets to inline - has index.html changed?")

    OUT_PATH.write_text(html, encoding="utf-8")
    size_mb = OUT_PATH.stat().st_size / (1024 * 1024)
    print(f"wrote {OUT_PATH.relative_to(ROOT)} "
          f"({styles} stylesheet, {scripts} scripts, {size_mb:.2f} MB)")


if __name__ == "__main__":
    build()
