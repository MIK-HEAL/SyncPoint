/** Filesystem and serialization helpers used by admin commands. */

import fs from "node:fs";
import path from "node:path";

export function walkDir(dir: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...walkDir(full));
      } else {
        results.push(full);
      }
    }
  } catch { /* best-effort */ }
  return results;
}

export function dirSize(dir: string): number {
  return walkDir(dir).reduce((sum, f) => {
    try { return sum + fs.statSync(f).size; } catch { return sum; }
  }, 0);
}

export function jsonToYaml(obj: unknown, indent = ""): string {
  if (obj === null || obj === undefined) return "null";
  if (typeof obj === "boolean" || typeof obj === "number") return String(obj);
  if (typeof obj === "string") {
    if (obj.includes("\n") || obj.includes(":") || obj.includes("#")) {
      return `"${obj.replace(/"/g, '\\"')}"`;
    }
    return obj;
  }
  if (Array.isArray(obj)) {
    if (obj.length === 0) return "[]";
    return obj.map((item: unknown) => `${indent}- ${jsonToYaml(item, indent + "  ")}`).join("\n");
  }
  if (typeof obj === "object") {
    const entries = Object.entries(obj as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    return entries.map(([key, value]) => `${indent}${key}: ${jsonToYaml(value, indent + "  ")}`).join("\n");
  }
  return String(obj);
}

export function parseSimpleYaml(raw: string): Record<string, unknown> {
  // Reuse the config parser approach
  const result: Record<string, unknown> = {};
  const lines = raw.split("\n");
  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const valuePart = trimmed.slice(colonIdx + 1).trim();
    if (valuePart === "" || valuePart === "{}") {
      result[key] = {};
    } else if (valuePart === "true") {
      result[key] = true;
    } else if (valuePart === "false") {
      result[key] = false;
    } else if (/^-?\d+$/.test(valuePart)) {
      result[key] = parseInt(valuePart, 10);
    } else {
      result[key] = valuePart.replace(/^["']|["']$/g, "");
    }
  }
  return result;
}

