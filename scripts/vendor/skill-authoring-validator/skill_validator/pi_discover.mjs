#!/usr/bin/env node
import { basename, dirname, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [, , piIndex, rawDir, mode = "pi"] = process.argv;
if (!piIndex || !rawDir || !["pi", "agents"].includes(mode)) {
  console.error("usage: pi_discover.mjs <pi-dist-index.js> <directory> <pi|agents>");
  process.exit(2);
}

const directory = resolve(rawDir);
const { loadSkillsFromDir } = await import(pathToFileURL(resolve(piIndex)).href);
const result = loadSkillsFromDir({ dir: directory, source: "path" });
const paths = new Set(result.skills.map((skill) => resolve(skill.filePath)));
for (const diagnostic of result.diagnostics) {
  if (typeof diagnostic.path === "string" && extname(diagnostic.path).toLowerCase() === ".md") {
    paths.add(resolve(diagnostic.path));
  }
}

const filtered = [...paths]
  .filter((path) => mode === "pi" || dirname(path) !== directory || basename(path) === "SKILL.md")
  .sort();

const selected = new Set(filtered);
const skills = result.skills
  .filter((skill) => selected.has(resolve(skill.filePath)))
  .map((skill) => ({
    path: resolve(skill.filePath),
    name: skill.name,
    disableModelInvocation: skill.disableModelInvocation,
  }));

process.stdout.write(JSON.stringify({ paths: filtered, skills, diagnostics: result.diagnostics }));
