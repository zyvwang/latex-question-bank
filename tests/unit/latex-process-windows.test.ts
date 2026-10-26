import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("process", { ...process, platform: "win32" });
  spawnMock.mockReset();
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Windows TeX cleanup", () => {
  it("waits for taskkill and coalesces duplicate termination", async () => {
    const killer = new EventEmitter();
    spawnMock.mockReturnValue(killer);
    const { terminateProcessTree } = await import("../../server/latex-process.js");
    const child = { pid: 123 } as ChildProcess;
    const first = terminateProcessTree(child);
    expect(terminateProcessTree(child)).toBe(first);
    expect(spawnMock).toHaveBeenCalledWith("taskkill", ["/pid", "123", "/T", "/F"], expect.anything());
    killer.emit("close", 0);
    await expect(first).resolves.toBeUndefined();
  });
  it.each(["error", "close"])("reports taskkill %s failures", async (event) => {
    const killer = new EventEmitter();
    spawnMock.mockReturnValue(killer);
    const { terminateProcessTree } = await import("../../server/latex-process.js");
    const result = terminateProcessTree({ pid: 123 } as ChildProcess);
    const assertion = expect(result).rejects.toThrow("taskkill");
    killer.emit(event, event === "error" ? new Error("ENOENT") : 1);
    await assertion;
  });
  it("bounds a stalled taskkill", async () => {
    vi.useFakeTimers();
    const killer = Object.assign(new EventEmitter(), { kill: vi.fn() });
    spawnMock.mockReturnValue(killer);
    const { terminateProcessTree } = await import("../../server/latex-process.js");
    const assertion = expect(terminateProcessTree({ pid: 123 } as ChildProcess)).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
    expect(killer.kill).toHaveBeenCalledOnce();
  });
});
