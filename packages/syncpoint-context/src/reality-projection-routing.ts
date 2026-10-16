/** Kind and projection-target routing for reality memory items. */

// ── Kind → bucket mapping ────────────────────────────────

export type BucketName = "verifiedFacts" | "activeConstraints" | "risks" | "doNotTouch" | "protocolRules" | "constraintRules";

/** Default kind→bucket mapping (used when projectionTarget is null). */
function kindToBucket(kind: string): BucketName {
  switch (kind) {
    case "fact":             return "verifiedFacts";
    case "soft_convention":  return "activeConstraints";
    case "risk":             return "risks";
    case "do_not_touch":     return "doNotTouch";
    case "hard_constraint":  return "constraintRules";
    case "protocol_rule":    return "protocolRules";
    default:                 return "verifiedFacts";
  }
}

/** Map projectionTarget value → bucket name. */
function targetToBucket(target: string): BucketName | null {
  switch (target) {
    case "context_snapshot":    return null; // context_snapshot routes by kind
    case "protocol_gate":       return "protocolRules";
    case "constraint_runtime":  return "constraintRules";
    default:                    return null;
  }
}

/** Map context-snapshot-targeted item to the appropriate sub-bucket by kind. */
function kindToSnapshotBucket(kind: string): BucketName {
  switch (kind) {
    case "fact":             return "verifiedFacts";
    case "soft_convention":  return "activeConstraints";
    case "risk":             return "risks";
    case "do_not_touch":     return "doNotTouch";
    case "hard_constraint":  return "verifiedFacts"; // fallback when explicitly context_snapshot-targeted
    case "protocol_rule":    return "verifiedFacts"; // fallback when explicitly context_snapshot-targeted
    default:                 return "verifiedFacts";
  }
}

export interface ProjectionRoute {
  buckets: BucketName[];
  reason: string;
}

/**
 * Resolve where a memory should be routed.
 * If projectionTarget is set, it overrides the default kindToBucket mapping.
 * Returns one or more buckets (multi-bucket routing when no explicit target).
 */
export function resolveProjectionRoute(kind: string, projectionTarget: string | null): ProjectionRoute {
  // Explicit target overrides default routing
  if (projectionTarget) {
    const bucket = targetToBucket(projectionTarget);
    if (bucket) {
      return {
        buckets: [bucket],
        reason: `${kind} → ${bucket} (explicit target: ${projectionTarget})`,
      };
    }
    // target === "context_snapshot" — route by kind to context snapshot sub-bucket
    if (projectionTarget === "context_snapshot") {
      const capBucket = kindToSnapshotBucket(kind);
      return {
        buckets: [capBucket],
        reason: `${kind} → ${capBucket} (explicit target: context_snapshot)`,
      };
    }
    // Unknown target — fall through to default
  }

  // Default routing by kind
  const defaultBucket = kindToBucket(kind);

  return {
    buckets: [defaultBucket],
    reason: projectionReasonForKind(kind),
  };
}

export function projectionReasonForKind(kind: string): string {
  switch (kind) {
    case "fact":             return "fact → contextPatch.verifiedFacts";
    case "soft_convention":  return "soft_convention → contextPatch.activeConstraints";
    case "risk":             return "risk → contextPatch.risks";
    case "do_not_touch":     return "do_not_touch → contextPatch.doNotTouch";
    case "hard_constraint":  return "hard_constraint → constraintRules";
    case "protocol_rule":    return "protocol_rule → protocolRules";
    default:                 return `${kind} → verifiedFacts (fallback)`;
  }
}
