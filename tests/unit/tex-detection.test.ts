import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() => vi.fn());
vi.mock("../../server/latex-process.js", () => ({ runLatexProcess: run }));

beforeEach(() => {
  vi.resetModules();
  run.mockReset();
});

const success = { code: 0, log: "version 1", timedOut: false };
const missing = { code: null, log: "ENOENT", timedOut: false };

describe("TeX detection", () => {
  it("requires both tools and uses the compile environment for an override with spaces", async () => {
    run.mockResolvedValue(success);
    const { detectTexInstallation, createLatexProcessEnv } = await import("../../server/latex-runtime.js");
    const command = path.resolve(".tmp/TeX install/latexmk");
    const result = await detectTexInstallation(command);
    expect(result).toMatchObject({ available: true, command, source: "override" });
    expect(run).toHaveBeenNthCalledWith(2, "xelatex", ["-version"], expect.objectContaining({ env: createLatexProcessEnv(command), timeoutMs: 3000 }));
  });

  it("preserves the detected latexmk command when xelatex is missing", async () => {
    run.mockImplementation(async (command) => command === "xelatex" ? missing : success);
    const { detectTexInstallation } = await import("../../server/latex-runtime.js");
    expect(await detectTexInstallation("custom-latexmk")).toMatchObject({
      available: false, command: "custom-latexmk", missingCommand: "xelatex"
    });
  });

  it("reports a missing latexmk without claiming an incomplete installation is present", async () => {
    run.mockResolvedValue(missing);
    const { detectTexInstallation } = await import("../../server/latex-runtime.js");
    const result = await detectTexInstallation(null);
    expect(result).toMatchObject({ available: false, source: "missing", missingCommand: "latexmk" });
    expect(result.command).toBeUndefined();
  });

  it("reports engine probe timeouts", async () => {
    run.mockImplementation(async (command) => command === "xelatex" ? { ...missing, timedOut: true } : success);
    const { detectTexInstallation } = await import("../../server/latex-runtime.js");
    expect((await detectTexInstallation("slow-engine")).message).toContain("检测超时");
  });

  it("coalesces and caches matching probes, and invalidates a changed override", async () => {
    run.mockResolvedValue(success);
    const { detectTexInstallation } = await import("../../server/latex-runtime.js");
    const results = await Promise.all([detectTexInstallation("first"), detectTexInstallation("first")]);
    expect(results[0]).toEqual(results[1]);
    await detectTexInstallation("first");
    expect(run).toHaveBeenCalledTimes(2);
    await detectTexInstallation("second");
    expect(run).toHaveBeenCalledTimes(4);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 31000);
    await detectTexInstallation("second");
    expect(run).toHaveBeenCalledTimes(6);
  });
});
