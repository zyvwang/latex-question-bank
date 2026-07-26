import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { isNotFound } from "./storage-utils.js";

export async function cleanupTempDirectory(
  tempDir: string,
  maxAgeMs = 7 * 24 * 60 * 60 * 1000
) {
  let entries: string[];
  try {
    entries = await readdir(tempDir);
  } catch (error) {
    if (isNotFound(error)) return;
    throw error;
  }
  const cutoff = Date.now() - maxAgeMs;
  await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(tempDir, entry);
      try {
        const metadata = await stat(target);
        if (metadata.mtimeMs < cutoff) {
          await rm(target, { recursive: true, force: true });
        }
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    })
  );
}
