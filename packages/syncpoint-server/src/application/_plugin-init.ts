/**
 * Auto-register first-party plugins at import time.
 * Side-effect module — import for registration only.
 */
export {
  ensureApplicationBootstrap,
  getApplicationBootstrapStatus,
  resetApplicationBootstrapForTest,
} from "./bootstrap.js";
