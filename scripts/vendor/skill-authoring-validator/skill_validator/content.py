"""Check skill package size and delegate Markdown reference validation."""

from __future__ import annotations

from dataclasses import dataclass

from .discovery import SkillSource
from .links import check_links


@dataclass(frozen=True)
class ContentFinding:
    code: str
    message: str
    governed: bool = False


def _size_findings(source: SkillSource, entry_text: str) -> list[ContentFinding]:
    findings: list[ContentFinding] = []
    lines = len(entry_text.splitlines())
    size = len(entry_text.encode("utf-8"))
    if lines > 200 or size > 12_000:
        findings.append(
            ContentFinding("long-entrypoint", f"entry point is {lines} lines/{size} bytes; split detailed content", True)
        )
    if source.standalone:
        return findings
    for markdown in source.package_root.rglob("*.md"):
        if markdown == source.path:
            continue
        try:
            detail = markdown.read_text(encoding="utf-8")
        except (OSError, UnicodeError) as error:
            findings.append(ContentFinding("read-failed", f"cannot read {markdown}: {error}"))
            continue
        detail_lines = len(detail.splitlines())
        detail_size = len(detail.encode("utf-8"))
        if detail_lines > 400 or detail_size > 24_000:
            findings.append(
                ContentFinding(
                    "long-supporting-file",
                    f"{markdown.relative_to(source.package_root)} is {detail_lines} lines/{detail_size} bytes",
                    True,
                )
            )
    return findings


def check_content(source: SkillSource, entry_text: str) -> list[ContentFinding]:
    link_findings = [ContentFinding(code, message, governed) for code, message, governed in check_links(source)]
    return [*_size_findings(source, entry_text), *link_findings]
