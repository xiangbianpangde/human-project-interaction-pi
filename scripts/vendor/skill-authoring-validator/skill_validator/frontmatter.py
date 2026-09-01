"""Restricted, dependency-free YAML frontmatter parser for governed Pi skills."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass

_KEY_RE = re.compile(r"^([A-Za-z0-9_-]+):(?:\s*(.*))?$")
_META_RE = re.compile(r"^[ \t]+([A-Za-z0-9_-]+):(?:\s*(.*))?$")
_BLOCK_MARKERS = {">", ">-", ">+", "|", "|-", "|+"}


class FrontmatterError(ValueError):
    """Raised when frontmatter cannot be interpreted safely."""


@dataclass(frozen=True)
class Frontmatter:
    fields: dict[str, object]
    metadata: dict[str, str]
    end_line: int


def _strip_inline_comment(raw: str) -> str:
    single = False
    double = False
    escaped = False
    for index, char in enumerate(raw):
        if escaped:
            escaped = False
            continue
        if char == "\\" and double:
            escaped = True
            continue
        if char == "'" and not double:
            single = not single
        elif char == '"' and not single:
            double = not double
        elif char == "#" and not single and not double and (index == 0 or raw[index - 1].isspace()):
            return raw[:index].rstrip()
    return raw.strip()


def _scalar(raw: str, line_number: int) -> object:
    raw = _strip_inline_comment(raw.strip())
    if not raw:
        return ""
    if raw.startswith('"'):
        try:
            value = json.loads(raw)
        except json.JSONDecodeError as error:
            raise FrontmatterError(f"line {line_number}: invalid double-quoted scalar") from error
        if not isinstance(value, str):
            raise FrontmatterError(f"line {line_number}: scalar must be a string")
        return value
    if raw.startswith("'"):
        if len(raw) < 2 or not raw.endswith("'"):
            raise FrontmatterError(f"line {line_number}: invalid single-quoted scalar")
        return raw[1:-1].replace("''", "'")
    lowered = raw.lower()
    if lowered in {"true", "false"}:
        return lowered == "true"
    if lowered in {"null", "~"}:
        return None
    if re.fullmatch(r"[-+]?\d+", raw):
        return int(raw)
    if re.fullmatch(r"[-+]?(?:\d+\.\d*|\d*\.\d+)(?:[eE][-+]?\d+)?", raw):
        return float(raw)
    return raw


def _block(lines: list[str], start: int, end: int, marker: str) -> tuple[str, int]:
    collected: list[str] = []
    index = start
    while index < end:
        line = lines[index]
        if line.strip() and not line[0].isspace():
            break
        collected.append(line)
        index += 1

    nonblank = [line for line in collected if line.strip()]
    if not nonblank:
        return "", index
    indent = min(len(line) - len(line.lstrip(" \t")) for line in nonblank)
    content = [line[indent:] if line.strip() else "" for line in collected]

    if marker.startswith("|"):
        value = "\n".join(content).rstrip("\n")
    else:
        paragraphs: list[str] = []
        current: list[str] = []
        for line in content:
            if line.strip():
                current.append(line.strip())
            elif current:
                paragraphs.append(" ".join(current))
                current = []
        if current:
            paragraphs.append(" ".join(current))
        value = "\n\n".join(paragraphs)
    return value, index


def parse_frontmatter(text: str) -> Frontmatter:
    lines = text.lstrip("\ufeff").splitlines()
    if not lines or lines[0].strip() != "---":
        raise FrontmatterError("missing opening YAML frontmatter delimiter")
    try:
        end = next(index for index in range(1, len(lines)) if lines[index].strip() == "---")
    except StopIteration as error:
        raise FrontmatterError("missing closing YAML frontmatter delimiter") from error

    fields: dict[str, object] = {}
    metadata: dict[str, str] = {}
    index = 1
    while index < end:
        line = lines[index]
        if not line.strip() or line.lstrip().startswith("#"):
            index += 1
            continue
        if line[0].isspace():
            raise FrontmatterError(f"line {index + 1}: unexpected indentation")
        match = _KEY_RE.fullmatch(line)
        if not match:
            raise FrontmatterError(f"line {index + 1}: unsupported frontmatter syntax")
        key = match.group(1)
        raw = (match.group(2) or "").strip()
        if key in fields or (key == "metadata" and metadata):
            raise FrontmatterError(f"line {index + 1}: duplicate key '{key}'")

        if key == "metadata":
            if raw:
                raise FrontmatterError(f"line {index + 1}: metadata must be an indented mapping")
            fields[key] = ""
            index += 1
            while index < end:
                nested = lines[index]
                if not nested.strip():
                    index += 1
                    continue
                if not nested[0].isspace():
                    break
                nested_match = _META_RE.fullmatch(nested)
                if not nested_match:
                    raise FrontmatterError(f"line {index + 1}: unsupported metadata syntax")
                nested_key = nested_match.group(1)
                nested_raw = (nested_match.group(2) or "").strip()
                if nested_key in metadata:
                    raise FrontmatterError(f"line {index + 1}: duplicate metadata key '{nested_key}'")
                if nested_raw in _BLOCK_MARKERS:
                    raise FrontmatterError(f"line {index + 1}: metadata values must be scalar strings")
                nested_value = _scalar(nested_raw, index + 1)
                if not isinstance(nested_value, str):
                    raise FrontmatterError(
                        f"line {index + 1}: governed metadata values must be quoted strings"
                    )
                metadata[nested_key] = nested_value
                index += 1
            continue

        if raw in _BLOCK_MARKERS:
            value, index = _block(lines, index + 1, end, raw)
            fields[key] = value
            continue
        fields[key] = _scalar(raw, index + 1)
        index += 1

    return Frontmatter(fields=fields, metadata=metadata, end_line=end + 1)
