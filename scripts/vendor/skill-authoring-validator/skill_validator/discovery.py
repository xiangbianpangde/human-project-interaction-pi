"""Discover exactly the skill entry points selected by the installed Pi loader."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Literal, cast

RootMode = Literal["auto", "pi", "agents"]


@dataclass(frozen=True)
class SkillSource:
    path: Path
    expected_name: str
    package_root: Path
    standalone: bool = False


def _source(path: Path) -> SkillSource:
    standalone = path.name != "SKILL.md"
    return SkillSource(
        path=path,
        expected_name=path.stem if standalone else path.parent.name,
        package_root=path.parent,
        standalone=standalone,
    )


def _mode(target: Path, requested: RootMode) -> Literal["pi", "agents"]:
    if requested != "auto":
        return requested
    return "agents" if ".agents" in target.parts else "pi"


@lru_cache(maxsize=1)
def _pi_index() -> Path:
    candidates: list[Path] = []
    override = os.environ.get("PI_CODING_AGENT_PACKAGE")
    if override:
        base = Path(override).expanduser()
        candidates.extend([base, base / "index.js", base / "dist" / "index.js"])
    pi_executable = shutil.which("pi")
    if pi_executable:
        resolved = Path(pi_executable).resolve()
        candidates.extend([resolved.parent / "index.js", resolved.parent / "dist" / "index.js"])
    npm = shutil.which("npm")
    if npm:
        result = subprocess.run([npm, "root", "-g"], text=True, capture_output=True, check=False, timeout=15)
        if result.returncode == 0 and result.stdout.strip():
            candidates.append(Path(result.stdout.strip()) / "@earendil-works" / "pi-coding-agent" / "dist" / "index.js")
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    raise RuntimeError("cannot locate the installed @earendil-works/pi-coding-agent dist/index.js")


def pi_snapshot(target: Path, mode: Literal["pi", "agents"] = "pi") -> dict[str, object]:
    node = shutil.which("node")
    if not node:
        raise RuntimeError("node is required to query Pi skill discovery")
    helper = Path(__file__).with_name("pi_discover.mjs")
    result = subprocess.run(
        [node, str(helper), str(_pi_index()), str(target), mode],
        text=True,
        capture_output=True,
        check=False,
        timeout=30,
    )
    if result.returncode != 0:
        message = result.stderr.strip() or result.stdout.strip() or f"node exited {result.returncode}"
        raise RuntimeError(f"Pi skill discovery failed: {message}")
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError("Pi skill discovery returned invalid JSON") from error
    if not isinstance(payload, dict):
        raise RuntimeError("Pi skill discovery returned a non-object payload")
    return cast(dict[str, object], payload)


def _pi_paths(target: Path, mode: Literal["pi", "agents"]) -> list[Path]:
    paths = pi_snapshot(target, mode).get("paths")
    if not isinstance(paths, list) or any(not isinstance(path, str) for path in paths):
        raise RuntimeError("Pi skill discovery returned invalid paths")
    return [Path(path) for path in paths]


def discover_target(target: Path, root_mode: RootMode = "auto") -> tuple[list[SkillSource], list[str]]:
    if not target.exists():
        return [], ["target does not exist"]
    if target.is_file():
        if target.suffix.lower() != ".md":
            return [], ["skill entry point must be a Markdown file"]
        return [_source(target)], []
    if not target.is_dir():
        return [], ["target is neither a file nor a directory"]
    try:
        paths = _pi_paths(target, _mode(target, root_mode))
    except (OSError, subprocess.SubprocessError, RuntimeError) as error:
        return [], [str(error)]
    if not paths:
        return [], ["no skill entry points found"]
    return [_source(path) for path in paths], []


def discover_targets(
    targets: list[Path], root_mode: RootMode = "auto"
) -> tuple[list[SkillSource], list[tuple[Path, str]]]:
    sources: list[SkillSource] = []
    errors: list[tuple[Path, str]] = []
    for target in targets:
        found, target_errors = discover_target(target, root_mode)
        sources.extend(found)
        errors.extend((target, message) for message in target_errors)
    unique = {source.path.resolve(): source for source in sources}
    return [unique[path] for path in sorted(unique)], errors
