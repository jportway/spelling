#!/usr/bin/env python3
"""Fold each game into one self-contained HTML file.

The games already run from a plain folder, but a single file is easier to
live with: you can email it, drop it on a USB stick, put it in Dropbox, or
open it straight from Downloads on a tablet with nothing else alongside it.

Usage
    python3 tools/build_standalone.py

Output
    wordbuilder.html     Cooper's Word Game
    missingletters.html  Cooper's Missing Letters

Each is about 1.5 MB with no external files and no network. Keep the two in
the same folder and the link between them on the start screens still works.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# source page -> single-file build
PAGES = {
    "index.html": "wordbuilder.html",
    "missing.html": "missingletters.html",
}

STYLESHEET = re.compile(r'[ \t]*<link rel="stylesheet" href="([^"]+)">\n?')
SCRIPT = re.compile(r'[ \t]*<script src="([^"]+)"[^>]*></script>\n?')
PRELOAD = re.compile(r'[ \t]*<link rel="preload"[^>]*>\n?')

# The pages fetch the definitions in the background; a single file has nowhere
# to fetch them from, so they get inlined at this marker instead.
DEFINITIONS_MARKER = re.compile(
    r'[ \t]*<!-- definitions-inline-here:.*?-->\n?', re.S)
DEFINITIONS_ASSET = "data/definitions.js"

_asset_cache: dict[str, str] = {}


def read_asset(reference: str) -> str:
    if reference in _asset_cache:
        return _asset_cache[reference]

    path = ROOT / reference
    if not path.exists():
        sys.exit(f"missing {path}")
    text = path.read_text(encoding="utf-8")
    # A literal </script> inside inlined JavaScript would close the tag early.
    # Nothing in this project contains one, but a build step that silently
    # produces a broken file is worse than one that stops.
    if "</script>" in text.lower():
        sys.exit(f"{reference} contains a literal </script> and cannot be inlined")

    _asset_cache[reference] = text
    return text


def build_page(source_name: str, out_name: str) -> None:
    source = ROOT / source_name
    if not source.exists():
        sys.exit(f"missing {source}")

    html = source.read_text(encoding="utf-8")

    # The preload only helps when the script is a separate request.
    html = PRELOAD.sub("", html)

    def inline_style(match: re.Match[str]) -> str:
        return "<style>\n" + read_asset(match.group(1)) + "</style>\n"

    def inline_script(match: re.Match[str]) -> str:
        return "<script>\n" + read_asset(match.group(1)) + "</script>\n"

    html, marker = DEFINITIONS_MARKER.subn(
        lambda _: "<script>\n" + read_asset(DEFINITIONS_ASSET) + "</script>\n", html)
    html, styles = STYLESHEET.subn(inline_style, html)
    html, scripts = SCRIPT.subn(inline_script, html)

    if not styles or not scripts or not marker:
        sys.exit(f"found no assets to inline - has {source_name} changed?")
    scripts += marker

    # The link across to the other game has to point at the other *single
    # file*, not at the folder version, or it dead-ends the moment the file is
    # opened on its own from Downloads.
    links = 0
    for page_source, page_out in PAGES.items():
        html, hits = re.subn(f'href="{re.escape(page_source)}"',
                             f'href="{page_out}"', html)
        links += hits

    out_path = ROOT / out_name
    out_path.write_text(html, encoding="utf-8")
    size_mb = out_path.stat().st_size / (1024 * 1024)
    print(f"wrote {out_name} "
          f"({styles} stylesheets, {scripts} scripts, {links} cross-link, "
          f"{size_mb:.2f} MB)")


def build() -> None:
    for source_name, out_name in PAGES.items():
        build_page(source_name, out_name)


if __name__ == "__main__":
    build()
