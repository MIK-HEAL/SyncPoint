#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = path.join(root, ".tmp", "npm-release", "v0.1.0");
const installDir = path.join(root, ".tmp", "npm-release-install");

const packages = [
  { filter: "syncpoint-core", tarball: "syncpoint-core-0.1.0.tgz" },
  { filter: "syncpoint-server", tarball: "syncpoint-server-0.1.0.tgz" },
  { filter: "@syncpoint/cli", tarball: "syncpoint-cli-0.1.0.tgz" },
];

const args = new Set(process.argv.slice(2));
const skipTests = args.has("--skip-tests");
const skipInstall = args.has("--skip-install");

function bin(name) {
  if (process.platform !== "win32") return name;
  if (/\.(cmd|bat|exe)$/i.test(name)) return name;
  return `${name}.cmd`;
}

function run(command, commandArgs, options = {}) {
  console.log(`\n$ ${command} ${commandArgs.join(" ")}`);
  const result = spawnSync(bin(command), commandArgs, {
    cwd: options.cwd ?? root,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...options.env },
  });
  if (result.error) {
    console.error(result.error.message);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function readTarballPackageJson(tarballPath) {
  const result = spawnSync("tar", ["-xOf", tarballPath, "package/package.json"], {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(`Could not read package.json from ${tarballPath}`);
  }
  return JSON.parse(result.stdout);
}

function assertNoWorkspaceDeps(tarballPath) {
  const pkg = readTarballPackageJson(tarballPath);
  const allDeps = {
    ...pkg.dependencies,
    ...pkg.optionalDependencies,
    ...pkg.peerDependencies,
  };
  for (const [name, version] of Object.entries(allDeps)) {
    if (String(version).startsWith("workspace:")) {
      throw new Error(`${pkg.name} still has workspace dependency ${name}: ${version}`);
    }
  }
}

function prepareDirs() {
  fs.rmSync(releaseDir, { recursive: true, force: true });
  fs.rmSync(installDir, { recursive: true, force: true });
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.mkdirSync(installDir, { recursive: true });
}

function packAll() {
  for (const pkg of packages) {
    run("pnpm", ["--filter", pkg.filter, "pack", "--pack-destination", releaseDir]);
    const tarballPath = path.join(releaseDir, pkg.tarball);
    if (!fs.existsSync(tarballPath)) {
      throw new Error(`Expected tarball missing: ${tarballPath}`);
    }
    assertNoWorkspaceDeps(tarballPath);
  }
}

function installAndSmoke() {
  const tarballs = packages.map(pkg => path.join(releaseDir, pkg.tarball));
  run("npm", [
    "install",
    "--prefix",
    installDir,
    ...tarballs,
    "--no-audit",
    "--no-fund",
  ]);

  const syncpoint = process.platform === "win32"
    ? path.join(installDir, "node_modules", ".bin", "syncpoint.cmd")
    : path.join(installDir, "node_modules", ".bin", "syncpoint");

  run(syncpoint, ["--help"]);

  const smokeProject = path.join(root, ".tmp", "npm-release-smoke-project");
  fs.rmSync(smokeProject, { recursive: true, force: true });
  run(syncpoint, ["init", smokeProject]);
  run(syncpoint, ["demo", "--project", path.join(root, ".tmp", "npm-release-smoke-demo"), "--keep"]);
  run(syncpoint, ["status"], { cwd: smokeProject });
}

prepareDirs();
run("pnpm", ["build"]);
run("pnpm", ["typecheck"]);
if (!skipTests) run("pnpm", ["test"]);
packAll();
if (!skipInstall) installAndSmoke();

console.log("\nRelease artifacts ready:");
for (const pkg of packages) {
  console.log(`  ${path.relative(root, path.join(releaseDir, pkg.tarball))}`);
}
console.log("\nPublish order:");
console.log("  syncpoint-core -> syncpoint-server -> @syncpoint/cli");
