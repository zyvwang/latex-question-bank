export {
  readBank,
  readBankHead,
  readBankSnapshot,
  saveBankSnapshot
} from "./bank-storage.js";
export {
  listRecoveryCandidates,
  recoverBank
} from "./recovery-storage.js";
export { StorageError } from "./storage-types.js";
export type { WorkspaceDirs } from "./storage-types.js";
export {
  createEmptyWorkspace,
  createSampleWorkspace,
  ensureProjectDirs,
  ensureWorkspace,
  getCurrentWorkspaceDirs,
  getDefaultWorkspaceRoot,
  getWorkspaceDirs,
  isKnownWorkspacePath,
  listRecentWorkspaces,
  moveWorkspace,
  openExistingWorkspace,
  readAppState,
  removeWorkspace,
  switchWorkspace,
  workspaceExists,
  workspaceNameFromPath
} from "./workspace-storage.js";

import { cleanupTempDirectory } from "./temp-directory-cleanup.js";
import { getWorkspaceDirs } from "./workspace-storage.js";

export async function cleanupOldTempDirs(
  workspacePath: string,
  maxAgeMs?: number
) {
  await cleanupTempDirectory(
    getWorkspaceDirs(workspacePath).tempDir,
    maxAgeMs
  );
}
