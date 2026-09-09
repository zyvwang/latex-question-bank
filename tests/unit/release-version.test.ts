import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, expect, it } from "vitest";

const root = path.resolve(".tmp/vitest-release-version");
const script = path.resolve("scripts/verify-release-version.mjs");
beforeEach(async () => {
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
});

it.each([
  ["0.2.0", "0.2.0", "0.2.0", "refs/tags/v0.2.0", true],
  ["0.2.0-rc.1", "0.2.0-rc.1", "0.2.0-rc.1", "refs/tags/v0.2.0-rc.1", true],
  ["0.2.0", "0.2.0", "0.2.0", "refs/heads/main", true],
  ["0.2.0", "0.2.0", "0.2.0", "refs/tags/v0.3.0", false],
  ["0.2.0", "0.1.0", "0.2.0", "refs/heads/main", false],
  ["0.2.0", "0.2.0", "0.1.0", "", false],
  ["0.2.0", undefined, "0.2.0", "", false],
  ["0.2.0", "0.2.0", undefined, "", false],
  [undefined, undefined, undefined, "", false]
])("checks manifest %s, lock %s/%s and ref %s", async (version, lockVersion, rootVersion, ref, valid) => {
  await writeFile(path.join(root, "package.json"), JSON.stringify({ version }));
  await writeFile(path.join(root, "package-lock.json"), JSON.stringify({ version: lockVersion, packages: { "": { version: rootVersion } } }));
  const run = () => execFileSync(process.execPath, [script], {
    cwd: root, env: { ...process.env, GITHUB_REF: String(ref) }, stdio: "pipe", encoding: "utf8"
  });
  if (valid) expect(run()).toContain("Release version verified");
  else expect(run).toThrow();
});
