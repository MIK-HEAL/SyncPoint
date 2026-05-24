/**
 * Project Memory — long-lived project knowledge CRUD.
 */

export {
  checkMemoryDuplicate,
  getProjectMemory,
  listProjectMemories,
  searchProjectMemories,
  collectProjectMemories,
} from "./project-memory-repository-read.js";

export type { CollectedMemory } from "./project-memory-repository-read.js";

export {
  createProjectMemory,
  updateProjectMemory,
  approveProjectMemory,
  deprecateProjectMemory,
  supersedeProjectMemory,
} from "./project-memory-repository-write.js";

export {
  getMemoryVersion,
  bumpMemoryVersion,
} from "./project-memory-repository-version.js";

