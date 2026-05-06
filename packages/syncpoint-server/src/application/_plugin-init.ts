/**
 * Auto-register first-party plugins at import time.
 * Side-effect module — import for registration only.
 */
import { registerCodePlugin } from "syncpoint-plugin-code";
import { registerGenericAgentPlugin } from "syncpoint-plugin-generic-agent";

registerCodePlugin();
registerGenericAgentPlugin();
