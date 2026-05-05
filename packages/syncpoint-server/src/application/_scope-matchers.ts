/**
 * Register scope matchers for file/module prefix overlap.
 * Import this module to ensure matchers are registered (idempotent).
 */
import { registerScopeMatcher, getScopeMatcher } from "syncpoint-core";

function prefixFindOverlaps(patterns: string[], locators: string[]): string[] {
  return locators.filter(loc =>
    patterns.some(p => {
      const prefix = p.replace(/\*\*?\/?$/, "");
      return loc === p || loc.startsWith(prefix);
    }),
  );
}

if (!getScopeMatcher("files")) {
  registerScopeMatcher({ field: "files", findOverlaps: prefixFindOverlaps });
}
if (!getScopeMatcher("modules")) {
  registerScopeMatcher({ field: "modules", findOverlaps: prefixFindOverlaps });
}
