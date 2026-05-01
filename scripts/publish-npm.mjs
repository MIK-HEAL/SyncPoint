#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = path.join(root, ".tmp", "npm-release", "v0.1.0");
const tarballs = [
  "syncpoint-core-0.1.0.tgz",
  "syncpoint-server-0.1.0.tgz",
  "syncpoint-cli-0.1.0.tgz",
].map(name => path.join(releaseDir, name));

const args = new Set(process.argv.slice(2));
const dryRun = !args.has("--yes");

function bin(name) {
  if (process.platform !== "win32") return name;
  if (/\.(cmd|bat|exe)$/i.test(name)) return name;
  return `${name}.cmd`;
}

function run(command, commandArgs) {
  console.log(`\n$ ${command} ${commandArgs.join(" ")}`);
  const result = spawnSync(bin(command), commandArgs, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (result.error) {
    console.error(result.error.message);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

for (const tarball of tarballs) {
  if (!fs.existsSync(tarball)) {
    console.error(`Missing release artifact: ${tarball}`);
    console.error("Run `pnpm release:npm` first.");
    process.exit(1);
  }
}

if (dryRun) {
  console.log("Dry run. Add --yes to publish for real.");
}

for (const tarball of tarballs) {
  const args = ["publish", tarball];
  if (dryRun) args.push("--dry-run");
  run("npm", args);
}
