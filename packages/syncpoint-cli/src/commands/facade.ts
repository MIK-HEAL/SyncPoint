/** Root-level CLI commands for status, resource claims, loop control, and wakes. */

import { Command } from "commander";
import { registerLoopCommands } from "./facade/loop.js";
import { registerResourceCommands } from "./facade/resources.js";
import { registerStatusCommand } from "./facade/status.js";

export function registerFacadeCommands(program: Command): void {
  registerStatusCommand(program);
  registerResourceCommands(program);
  registerLoopCommands(program);
}
