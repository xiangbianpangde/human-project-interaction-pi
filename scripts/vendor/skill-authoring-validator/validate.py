#!/usr/bin/env python3
"""Validate Pi skills against loader requirements and optional governance rules."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True

from skill_validator import discover_targets, validate_sources


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("targets", nargs="+", help="SKILL.md, skill directory, or skill root")
    parser.add_argument(
        "--strict",
        action="store_true",
        help="treat governed profile violations as errors",
    )
    parser.add_argument(
        "--format",
        choices=("text", "json"),
        default="text",
        help="output format (default: text)",
    )
    parser.add_argument(
        "--root-mode",
        choices=("auto", "pi", "agents"),
        default="auto",
        help="root Markdown rule: infer from path, force Pi, or force .agents semantics",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    targets = [Path(value).expanduser().resolve() for value in args.targets]
    sources, target_errors = discover_targets(targets, root_mode=args.root_mode)
    reports = validate_sources(sources, strict=args.strict)

    error_count = len(target_errors) + sum(report.error_count for report in reports)
    warning_count = sum(report.warning_count for report in reports)
    summary = {
        "validated": len(reports),
        "errors": error_count,
        "warnings": warning_count,
        "strict": args.strict,
    }

    if args.format == "json":
        print(
            json.dumps(
                {
                    "reports": [report.as_dict() for report in reports],
                    "targetIssues": [
                        {
                            "path": str(path),
                            "severity": "error",
                            "code": "target-invalid",
                            "message": message,
                        }
                        for path, message in target_errors
                    ],
                    "summary": summary,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    else:
        for path, message in target_errors:
            print(f"FAIL {path}")
            print(f"  ERROR [target-invalid]: {message}")
        for report in reports:
            state = "FAIL" if report.error_count else "CHECK" if report.warning_count else "PASS"
            print(f"{state} {report.source.path}")
            for issue in report.issues:
                print(f"  {issue.severity.upper()} [{issue.code}]: {issue.message}")
        print(
            f"validated={summary['validated']} errors={summary['errors']} "
            f"warnings={summary['warnings']} strict={str(summary['strict']).lower()}"
        )
    return 1 if error_count else 0


if __name__ == "__main__":
    raise SystemExit(main())
