import { recoverVariantImports } from "./variant-import-storage.js";
import { recoverTypeCorrections } from "./variant-storage.js";
const workspaceWriteQueues = new Map<string, Promise<unknown>>();

export async function withWorkspaceWriteLock<T>(
  workspacePath: string,
  operation: () => Promise<T>
): Promise<T> {
  const previous = workspaceWriteQueues.get(workspacePath) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(async () => { await recoverTypeCorrections(workspacePath); await recoverVariantImports(workspacePath); return operation(); });
  workspaceWriteQueues.set(workspacePath, current);
  try {
    return await current;
  } finally {
    if (workspaceWriteQueues.get(workspacePath) === current) {
      workspaceWriteQueues.delete(workspacePath);
    }
  }
}
