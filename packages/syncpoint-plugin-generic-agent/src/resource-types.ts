/**
 * Generic resource types supported by this plugin.
 * Each type gets a ResourceMatcher registered at plugin init.
 */
export const GENERIC_RESOURCE_TYPES = [
  "artifact",
  "binary_asset",
  "document",
  "design_asset",
  "dataset_slice",
] as const;

export type GenericResourceType = (typeof GENERIC_RESOURCE_TYPES)[number];
