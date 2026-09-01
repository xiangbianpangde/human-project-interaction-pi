"""Validation rules for Pi Agent Skills and local governance metadata."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .content import check_content
from .discovery import SkillSource
from .frontmatter import FrontmatterError, parse_frontmatter

NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
SEMVER_RE = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)
TRIGGER_TOKEN_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
TRIGGER_CUE_RE = re.compile(r"\b(?:use|when|whenever)\b|使用|用于|适用于|触发|遇到|当.+时", re.IGNORECASE)
ALLOWED_FIELDS = {
    "name",
    "description",
    "license",
    "compatibility",
    "metadata",
    "allowed-tools",
    "disable-model-invocation",
}
REQUIRED_METADATA = {"version", "status", "layer", "priority", "triggers"}


@dataclass(frozen=True)
class Issue:
    severity: str
    code: str
    message: str

    def as_dict(self) -> dict[str, str]:
        return {"severity": self.severity, "code": self.code, "message": self.message}


@dataclass
class SkillReport:
    source: SkillSource
    name: str | None = None
    issues: list[Issue] = field(default_factory=list)

    def add(self, severity: str, code: str, message: str) -> None:
        self.issues.append(Issue(severity, code, message))

    def governed(self, strict: bool, code: str, message: str) -> None:
        self.add("error" if strict else "warning", code, message)

    @property
    def error_count(self) -> int:
        return sum(issue.severity == "error" for issue in self.issues)

    @property
    def warning_count(self) -> int:
        return sum(issue.severity == "warning" for issue in self.issues)

    def as_dict(self) -> dict[str, object]:
        return {
            "path": str(self.source.path),
            "name": self.name,
            "issues": [issue.as_dict() for issue in self.issues],
        }


def _string_field(report: SkillReport, fields: dict[str, object], key: str) -> str:
    if key not in fields:
        return ""
    value = fields[key]
    if not isinstance(value, str):
        report.add("error", "field-type-invalid", f"{key} must be a YAML string")
        return ""
    return value


def _changelog_has_version(text: str, version: str) -> bool:
    pattern = rf"^##[ \t]+{re.escape(version)}(?:[ \t]+-[ \t]+[^\r\n]+)?[ \t]*$"
    return re.search(pattern, text, re.MULTILINE) is not None


def validate_source(source: SkillSource, strict: bool = False) -> SkillReport:
    report = SkillReport(source)
    try:
        text = source.path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        report.add("error", "read-failed", str(error))
        return report
    try:
        parsed = parse_frontmatter(text)
    except FrontmatterError as error:
        report.add("error", "frontmatter-invalid", str(error))
        return report

    fields = parsed.fields
    metadata = parsed.metadata
    name = _string_field(report, fields, "name")
    description = _string_field(report, fields, "description")
    compatibility = _string_field(report, fields, "compatibility")
    report.name = name or None

    if not name:
        report.add("error", "name-missing", "missing name")
    elif len(name) > 64 or not NAME_RE.fullmatch(name):
        report.add("error", "name-invalid", "name must be 1-64 lowercase letters, digits, or single hyphens")
    elif name != source.expected_name:
        report.governed(strict, "name-path-mismatch", f"name '{name}' differs from expected '{source.expected_name}'")

    if not description:
        report.add("error", "description-missing", "missing description")
    elif len(description) > 1024:
        report.add("error", "description-too-long", "description exceeds 1024 characters")
    elif not TRIGGER_CUE_RE.search(description):
        report.governed(strict, "trigger-cue-missing", "description does not state an explicit activation condition")

    if len(compatibility) > 500:
        report.add("error", "compatibility-too-long", "compatibility exceeds 500 characters")
    unknown = sorted(set(fields) - ALLOWED_FIELDS)
    if unknown:
        report.governed(strict, "unknown-frontmatter", "unknown frontmatter fields: " + ", ".join(unknown))
    invocation = fields.get("disable-model-invocation")
    if "disable-model-invocation" in fields and not isinstance(invocation, bool):
        report.add("error", "invocation-invalid", "disable-model-invocation must be an unquoted YAML boolean")

    missing = sorted(REQUIRED_METADATA - metadata.keys())
    if missing:
        report.governed(strict, "metadata-missing", "governance metadata missing: " + ", ".join(missing))
    empty = sorted(key for key in REQUIRED_METADATA & metadata.keys() if not metadata[key].strip())
    if empty:
        report.governed(strict, "metadata-empty", "governance metadata is empty: " + ", ".join(empty))
    version = metadata.get("version", "")
    if version and not SEMVER_RE.fullmatch(version):
        report.governed(strict, "version-invalid", "metadata.version is not valid semantic versioning")
    if metadata.get("status") and metadata["status"] != "active":
        report.governed(strict, "inactive-discovered", "non-active skill remains in the active discovery tree")
    if metadata.get("layer") and metadata["layer"] not in {"core", "domain", "task"}:
        report.governed(strict, "layer-invalid", "metadata.layer must be core, domain, or task")
    priority = metadata.get("priority", "")
    if priority:
        try:
            if not 0 <= int(priority) <= 1000:
                raise ValueError
        except ValueError:
            report.governed(strict, "priority-invalid", "metadata.priority must be an integer string from 0 to 1000")
    triggers = [token.strip() for token in metadata.get("triggers", "").split(",") if token.strip()]
    if metadata.get("triggers") and any(not TRIGGER_TOKEN_RE.fullmatch(token) for token in triggers):
        report.governed(strict, "triggers-invalid", "metadata.triggers must contain comma-separated lowercase slugs")

    changelog = source.package_root / "CHANGELOG.md"
    if version and not source.standalone:
        if not changelog.is_file():
            report.governed(strict, "changelog-missing", "versioned skill has no CHANGELOG.md")
        else:
            try:
                changelog_text = changelog.read_text(encoding="utf-8")
            except (OSError, UnicodeError) as error:
                report.add("error", "changelog-read-failed", str(error))
            else:
                if not _changelog_has_version(changelog_text, version):
                    report.governed(strict, "changelog-version-missing", f"CHANGELOG.md has no exact section for {version}")

    for finding in check_content(source, text):
        if finding.governed:
            report.governed(strict, finding.code, finding.message)
        else:
            report.add("error", finding.code, finding.message)
    return report


def validate_sources(sources: list[SkillSource], strict: bool = False) -> list[SkillReport]:
    reports = [validate_source(source, strict) for source in sources]
    by_name: dict[str, list[SkillReport]] = {}
    for report in reports:
        if report.name:
            by_name.setdefault(report.name, []).append(report)
    for name, matches in by_name.items():
        if len(matches) > 1:
            paths = ", ".join(str(match.source.path) for match in matches)
            for report in matches:
                report.add("error", "name-collision", f"skill name '{name}' collides across: {paths}")
    return reports
