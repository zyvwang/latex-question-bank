import path from "node:path";

const expectedAppDataDir = path.resolve(".tmp/vitest-app-data");
if (path.resolve(process.env.LQB_APP_DATA_DIR ?? "") !== expectedAppDataDir) {
  throw new Error(
    "Vitest app data must be configured under .tmp/vitest-app-data before modules load."
  );
}
delete process.env.LQB_WORKSPACE_DIR;
