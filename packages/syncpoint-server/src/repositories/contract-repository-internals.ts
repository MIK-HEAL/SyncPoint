import type { PeerContract } from "syncpoint-core";
import * as s from "../schema.js";

export function serializeContractStringList(values: string[]): string {
  return JSON.stringify(values);
}

export function parseContractStringList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function hydrateContractRow(row: typeof s.peerContracts.$inferSelect): PeerContract {
  return {
    ...row,
    participants: parseContractStringList(row.participants),
    responsibilities: parseContractStringList(row.responsibilities),
    interfaceSpec: parseContractStringList(row.interfaceSpec),
    fileBoundaries: parseContractStringList(row.fileBoundaries),
    dependencies: parseContractStringList(row.dependencies),
  } as PeerContract;
}
