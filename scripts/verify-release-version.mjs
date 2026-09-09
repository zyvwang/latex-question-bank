import { readFile } from "node:fs/promises";

try {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
  const version = manifest.version;
  if (typeof version !== "string" || !version.trim()) {
    throw new Error("package.json.version is required");
  }
  if (lock.version !== version || lock.packages?.[""]?.version !== version) {
    throw new Error("package.json and both package-lock.json root versions must match");
  }
  const ref = process.env.GITHUB_REF ?? "";
  if (ref.startsWith("refs/tags/") && ref !== `refs/tags/v${version}`) {
    throw new Error(`Release tag must be v${version}; received ${ref.slice(10)}`);
  }
  console.log(`Release version verified: ${version}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
