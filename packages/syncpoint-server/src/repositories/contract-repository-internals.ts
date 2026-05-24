import { eq, inArray } from "drizzle-orm";
import type { PeerContract, PeerContractCreate } from "syncpoint-core";
import * as s from "../schema.js";
import { _getDb, createId } from "./_shared.js";

type PeerContractRow = typeof s.peerContracts.$inferSelect;

function groupContractListValues<T extends { contractId: string; position: number }>(
  rows: T[],
  getValue: (row: T) => string,
): Map<string, string[]> {
  const rowsByContract = new Map<string, T[]>();
  for (const row of rows) {
    const current = rowsByContract.get(row.contractId) ?? [];
    current.push(row);
    rowsByContract.set(row.contractId, current);
  }

  const valuesByContract = new Map<string, string[]>();
  for (const [contractId, contractRows] of rowsByContract) {
    valuesByContract.set(
      contractId,
      [...contractRows].sort((left, right) => left.position - right.position).map(getValue),
    );
  }

  return valuesByContract;
}

function replaceContractListRows(
  contractId: string,
  values: string[],
  deleteRows: () => void,
  insertRow: (value: string, position: number) => void,
): void {
  deleteRows();
  for (const [position, value] of values.entries()) {
    insertRow(value, position);
  }
}

export function replaceContractStructuredFields(
  contractId: string,
  data: Pick<PeerContractCreate, "participants" | "responsibilities" | "interfaceSpec" | "fileBoundaries" | "dependencies">,
): void {
  const db = _getDb();

  replaceContractListRows(
    contractId,
    data.participants,
    () => {
      db.delete(s.peerContractParticipants).where(eq(s.peerContractParticipants.contractId, contractId)).run();
    },
    (participant, position) => {
      db.insert(s.peerContractParticipants).values({
        id: createId(),
        contractId,
        position,
        participant,
      }).run();
    },
  );

  replaceContractListRows(
    contractId,
    data.responsibilities,
    () => {
      db.delete(s.peerContractResponsibilities).where(eq(s.peerContractResponsibilities.contractId, contractId)).run();
    },
    (responsibility, position) => {
      db.insert(s.peerContractResponsibilities).values({
        id: createId(),
        contractId,
        position,
        responsibility,
      }).run();
    },
  );

  replaceContractListRows(
    contractId,
    data.interfaceSpec,
    () => {
      db.delete(s.peerContractInterfaceSpecs).where(eq(s.peerContractInterfaceSpecs.contractId, contractId)).run();
    },
    (spec, position) => {
      db.insert(s.peerContractInterfaceSpecs).values({
        id: createId(),
        contractId,
        position,
        spec,
      }).run();
    },
  );

  replaceContractListRows(
    contractId,
    data.fileBoundaries,
    () => {
      db.delete(s.peerContractFileBoundaries).where(eq(s.peerContractFileBoundaries.contractId, contractId)).run();
    },
    (boundary, position) => {
      db.insert(s.peerContractFileBoundaries).values({
        id: createId(),
        contractId,
        position,
        boundary,
      }).run();
    },
  );

  replaceContractListRows(
    contractId,
    data.dependencies,
    () => {
      db.delete(s.peerContractDependencies).where(eq(s.peerContractDependencies.contractId, contractId)).run();
    },
    (dependency, position) => {
      db.insert(s.peerContractDependencies).values({
        id: createId(),
        contractId,
        position,
        dependency,
      }).run();
    },
  );
}

export function hydrateContractRows(rows: PeerContractRow[]): PeerContract[] {
  if (rows.length === 0) return [];

  const db = _getDb();
  const ids = rows.map(row => row.id);
  const participantRows = db.select().from(s.peerContractParticipants)
    .where(inArray(s.peerContractParticipants.contractId, ids))
    .all();
  const responsibilityRows = db.select().from(s.peerContractResponsibilities)
    .where(inArray(s.peerContractResponsibilities.contractId, ids))
    .all();
  const interfaceSpecRows = db.select().from(s.peerContractInterfaceSpecs)
    .where(inArray(s.peerContractInterfaceSpecs.contractId, ids))
    .all();
  const fileBoundaryRows = db.select().from(s.peerContractFileBoundaries)
    .where(inArray(s.peerContractFileBoundaries.contractId, ids))
    .all();
  const dependencyRows = db.select().from(s.peerContractDependencies)
    .where(inArray(s.peerContractDependencies.contractId, ids))
    .all();

  const participantsByContract = groupContractListValues(participantRows, row => row.participant);
  const responsibilitiesByContract = groupContractListValues(responsibilityRows, row => row.responsibility);
  const interfaceSpecByContract = groupContractListValues(interfaceSpecRows, row => row.spec);
  const fileBoundariesByContract = groupContractListValues(fileBoundaryRows, row => row.boundary);
  const dependenciesByContract = groupContractListValues(dependencyRows, row => row.dependency);

  return rows.map(row => ({
    ...row,
    participants: participantsByContract.get(row.id) ?? [],
    responsibilities: responsibilitiesByContract.get(row.id) ?? [],
    interfaceSpec: interfaceSpecByContract.get(row.id) ?? [],
    fileBoundaries: fileBoundariesByContract.get(row.id) ?? [],
    dependencies: dependenciesByContract.get(row.id) ?? [],
  }) as PeerContract);
}

export function hydrateContractRow(row: PeerContractRow): PeerContract {
  return hydrateContractRows([row])[0]!;
}
