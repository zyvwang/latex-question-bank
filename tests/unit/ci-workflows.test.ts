import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const realLatexWorkflowPaths = [
  ".github/workflows/ci.yml",
  ".github/workflows/release.yml"
];

describe("real LaTeX export workflows", () => {
  it.each(realLatexWorkflowPaths)(
    "%s installs the TeX Live package that provides extarrows.sty",
    async (workflowPath) => {
      const workflow = await readFile(path.resolve(workflowPath), "utf8");
      expect(workflow).toContain("texlive-science");
    }
  );
});
