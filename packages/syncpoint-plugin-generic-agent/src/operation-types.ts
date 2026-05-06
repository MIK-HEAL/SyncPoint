/**
 * Generic operation types supported by this plugin.
 * Each type gets OperationValidators registered at plugin init.
 */
export const GENERIC_OPERATION_TYPES = [
  "artifact_update",
  "artifact_review",
  "artifact_transform",
  "asset_generate",
  "asset_edit",
] as const;

export type GenericOperationType = (typeof GENERIC_OPERATION_TYPES)[number];
