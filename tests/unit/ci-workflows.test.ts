import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const realLatexWorkflowPaths = [
  ".github/workflows/ci.yml",
  ".github/workflows/release.yml"
];
const securityGatedJobs = new Map([
  [".github/workflows/ci.yml", ["verify", "latex-export", "desktop-smoke"]],
  [
    ".github/workflows/release.yml",
    ["verify-latex", "build-windows", "build-macos"]
  ]
]);
const immutableActionReference = /uses:\s+[^\s#]+@[0-9a-f]{40}(?:\s+#.*)?$/gm;
const anyActionReference = /uses:\s+[^\s#]+@[^\s#]+(?:\s+#.*)?$/gm;

describe("real LaTeX export workflows", () => {
  it.each(realLatexWorkflowPaths)(
    "%s installs the TeX Live package that provides extarrows.sty",
    async (workflowPath) => {
      const workflow = await readFile(path.resolve(workflowPath), "utf8");
      expect(workflow).toContain("texlive-science");
    }
  );
});

describe("GitHub Actions supply-chain boundaries", () => {
  it.each(realLatexWorkflowPaths)(
    "%s pins every third-party action to an immutable commit",
    async (workflowPath) => {
      const workflow = await readFile(path.resolve(workflowPath), "utf8");
      expect(workflow.match(immutableActionReference)).toEqual(
        workflow.match(anyActionReference)
      );
    }
  );

  it.each(realLatexWorkflowPaths)(
    "%s prevents checkout from persisting credentials",
    async (workflowPath) => {
      const workflow = await readFile(path.resolve(workflowPath), "utf8");
      const checkoutCount = workflow.match(/uses:\s+actions\/checkout@/g)?.length ?? 0;
      const hardenedCheckoutCount = workflow.match(/persist-credentials:\s+false/g)?.length ?? 0;

      expect(checkoutCount).toBeGreaterThan(0);
      expect(hardenedCheckoutCount).toBe(checkoutCount);
    }
  );

  it("grants release write access only to the publishing job", async () => {
    const workflow = await readFile(
      path.resolve(".github/workflows/release.yml"),
      "utf8"
    );

    expect(workflow).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(workflow.match(/contents:\s+write/g)).toHaveLength(1);
    expect(workflow).toMatch(
      /publish-github-release:\n(?:.*\n)*? {4}permissions:\n {6}contents: write/m
    );
  });

  it.each(realLatexWorkflowPaths)(
    "%s audits dependencies before installation jobs",
    async (workflowPath) => {
      const workflow = await readFile(path.resolve(workflowPath), "utf8");
      const auditJobStart = workflow.indexOf("  security-audit:");
      const firstInstall = workflow.indexOf("npm ci");

      expect(auditJobStart).toBeGreaterThan(-1);
      expect(workflow).toContain("run: npm run audit:security");
      expect(auditJobStart).toBeLessThan(firstInstall);

      for (const job of securityGatedJobs.get(workflowPath) ?? []) {
        expect(workflow).toMatch(
          new RegExp(
            `^  ${job}:\\n(?:    name:.*\\n)?    needs: security-audit$`,
            "m"
          )
        );
      }
    }
  );
});
