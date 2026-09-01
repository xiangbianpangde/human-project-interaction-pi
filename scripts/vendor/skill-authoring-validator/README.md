# Bundled Skill validator

This directory contains the deterministic validator snapshot from the governed Pi `skill-authoring` Skill version `1.2.0`.

`../../validate-skill.mjs` prefers the active validator under `PI_CODING_AGENT_DIR`/`HPI_PI_AGENT_DIR`. It uses this snapshot only when that active installation is unavailable, such as in a clean CI runner. Skill discovery still runs through this package's pinned `@earendil-works/pi-coding-agent` dependency.

Keep this directory byte-for-byte aligned with a reviewed governed validator release; do not edit individual rules locally.
