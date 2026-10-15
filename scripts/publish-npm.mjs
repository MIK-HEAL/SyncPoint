#!/usr/bin/env node

/** Publish the single supported npm package after release:npm has verified it. */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "packages", "syncpoint", "package.json"), "utf8"));
const releaseDir = path.join(root, ".tmp", "npm-release", `v${packageJson.version}`);
const tarball = path.join(releaseDir, `syncpoint-ai-${packageJson.version}.tgz`);
const publish = process.argv.includes("--yes") ? [] : ["--dry-run"];

if (!fs.existsSync(tarball)) {
  console.error("Missing release artifact. Run `pnpm release:npm` first.");
  process.exit(1);
}

const command = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(command, ["publish", tarball, ...publish], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
