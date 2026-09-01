"""Extract and validate inline, reference-style, and HTML links in skill Markdown."""

from __future__ import annotations

import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

from .discovery import SkillSource

Finding = tuple[str, str, bool]
INLINE_RE = re.compile(r"!?\[[^\]]*\]\(([^)\n]+)\)")
REFERENCE_RE = re.compile(r"!?\[([^\]]+)\]\[([^\]]*)\]")
DEFINITION_RE = re.compile(r"^[ \t]{0,3}\[([^\]]+)\]:[ \t]*(<[^>]+>|\S+)", re.MULTILINE)
FENCE_RE = re.compile(r"(?:```|~~~).*?(?:```|~~~)", re.DOTALL)


class _HtmlLinks(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.destinations: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        accepted = {"href"} if tag == "a" else {"src"} if tag in {"img", "source"} else set()
        for name, value in attrs:
            if name in accepted and value:
                self.destinations.append(value)


def _inside(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def _destination(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("<") and ">" in raw:
        return raw[1 : raw.index(">")]
    return raw.split(maxsplit=1)[0].strip('"')


def _destinations(body: str) -> tuple[list[str], list[str]]:
    destinations = [_destination(raw) for raw in INLINE_RE.findall(body)]
    definitions = {key.casefold(): _destination(value) for key, value in DEFINITION_RE.findall(body)}
    destinations.extend(definitions.values())
    missing: list[str] = []
    for label, key in REFERENCE_RE.findall(body):
        normalized = (key or label).strip().casefold()
        if normalized not in definitions:
            missing.append(key or label)
    parser = _HtmlLinks()
    parser.feed(body)
    destinations.extend(parser.destinations)
    return destinations, missing


def _check_destination(markdown: Path, root: Path, raw: str) -> Finding | None:
    destination = unquote(_destination(raw).split("#", 1)[0])
    if not destination:
        return None
    parsed = urlsplit(destination)
    if parsed.scheme or destination.startswith("//"):
        return None
    target = Path(destination)
    if target.is_absolute():
        return "absolute-link", f"{markdown.name} uses non-portable absolute link: {destination}", True
    candidate = markdown.parent / target
    if not _inside(candidate, root):
        return "escaping-link", f"{markdown.name} link escapes the skill package: {destination}", True
    if not candidate.exists():
        return "broken-link", f"{markdown.name} has broken relative link: {destination}", False
    return None


def check_links(source: SkillSource) -> list[Finding]:
    findings: list[Finding] = []
    root = source.package_root
    markdown_files = [source.path] if source.standalone else sorted(root.rglob("*.md"))
    for markdown in markdown_files:
        try:
            body = FENCE_RE.sub("", markdown.read_text(encoding="utf-8"))
        except (OSError, UnicodeError) as error:
            findings.append(("read-failed", f"cannot read {markdown}: {error}", False))
            continue
        destinations, missing_references = _destinations(body)
        for reference in missing_references:
            findings.append(("broken-reference", f"{markdown.name} has no definition for [{reference}]", False))
        for destination in destinations:
            finding = _check_destination(markdown, root, destination)
            if finding:
                findings.append(finding)
    return findings
