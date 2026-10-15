#!/usr/bin/env node

/**
 * Build, pack, install, and smoke-test the public syncpoint-ai package.
 * Workspace packages remain implementation details and are assembled into
 * syncpoint-ai before packing.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = path.join(root, "packages", "syncpoint");
const releaseVersion = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8")).version;
const releaseDir = path.join(root, ".tmp", "npm-release", `v${releaseVersion}`);
const installDir = path.join(root, ".tmp", "npm-release-install");
const tarball = path.join(releaseDir, `syncpoint-ai-${releaseVersion}.tgz`);

const args = new Set(process.argv.slice(2));
const skipTests = args.has("--skip-tests");
const skipInstall = args.has("--skip-install");

function bin(name) {
  return process.platform === "win32" && !/\.(cmd|bat|exe)$/i.test(name) ? `${name}.cmd` : name;
}

function run(command, commandArgs, options = {}) {
  console.log(`\n$ ${command} ${commandArgs.join(" ")}`);
  const result = spawnSync(bin(command), commandArgs, {
    cwd: options.cwd ?? root,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...options.env },
  });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function runJson(command, commandArgs, options = {}) {
  const result = spawnSync(bin(command), commandArgs, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: { ...process.env, ...options.env },
  });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  if (result.status !== 0) process.exit(result.status ?? 1);
  try {
    return JSON.parse(result.stdout ?? "");
  } catch {
    console.error("Smoke test expected valid JSON output.");
    process.exit(1);
  }
}

function prepareDirs() {
  fs.rmSync(releaseDir, { recursive: true, force: true });
  fs.rmSync(installDir, { recursive: true, force: true });
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.mkdirSync(installDir, { recursive: true });
}

function pack() {
  run("pnpm", ["--filter", "syncpoint-ai", "pack", "--pack-destination", releaseDir]);
  if (!fs.existsSync(tarball)) {
    console.error(`Expected tarball missing: ${tarball}`);
    process.exit(1);
  }
}

function installAndSmoke() {
  run("npm", ["install", "--prefix", installDir, tarball, "--no-audit", "--no-fund"]);
  const syncpoint = path.join(installDir, "node_modules", ".bin", process.platform === "win32" ? "syncpoint.cmd" : "syncpoint");
  const project = path.join(root, ".tmp", "npm-release-smoke-project");
  fs.rmSync(project, { recursive: true, force: true });
  run(syncpoint, ["init", project]);
  const blocked = runJson(syncpoint, ["demo", "conflict", "--project", path.join(project, "demo"), "--stage", "blocked", "--json"]);
  if (blocked.conflict !== true || typeof blocked.gateId !== "string") {
    console.error("Smoke test failed: the packaged conflict demo did not create a blocking gate.");
    process.exit(1);
  }
  run(syncpoint, ["status", "--json"], { cwd: project });
}

prepareDirs();
run("pnpm", ["build"]);
run("pnpm", ["typecheck"]);
if (!skipTests) run("pnpm", ["test"]);
pack();
if (!skipInstall) installAndSmoke();

console.log(`\nRelease artifact ready: ${path.relative(root, tarball)}`);
