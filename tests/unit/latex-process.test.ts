import { spawn } from "node:child_process";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runLatexProcess, terminateProcessTree } from "../../server/latex-process.js";

const groups = new Set<number>();
afterEach(() => {
  for (const pid of groups) {
    try { process.kill(-pid, "SIGKILL"); } catch { /* Already reaped. */ }
  }
  groups.clear();
});

describe.skipIf(process.platform === "win32")("TeX process group cleanup", () => {
  it("kills a child that ignores TERM after its parent has exited", async () => {
    const descendant = `process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000);`;
    const parent = `const {spawn}=require('node:child_process');
      const child=spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:['ignore','pipe','ignore']});
      child.stdout.once('data',()=>console.log(child.pid));
      setInterval(()=>{},1000);`;
    const child = spawn(process.execPath, ["-e", parent], { detached: true });
    groups.add(child.pid!);
    const [data] = await once(child.stdout, "data");
    const descendantPid = Number(String(data).trim());
    await terminateProcessTree(child);
    await expect.poll(() => {
      try { process.kill(descendantPid, 0); return true; } catch { return false; }
    }, { timeout: 2500 }).toBe(false);
  });

  it("accepts a process that already exited", async () => {
    const child = spawn(process.execPath, ["-e", ""], { detached: true });
    await once(child, "close");
    await expect(terminateProcessTree(child)).resolves.toBeUndefined();
  });
});


describe("bounded TeX execution", () => {
  it("returns normal exits and bounded output", async () => {
    const result = await runLatexProcess(process.execPath, ["-e", "console.log('x'.repeat(10000))"], {
      env: process.env, timeoutMs: 2000, maxOutputBytes: 1024
    });
    expect(result).toMatchObject({ code: 0, timedOut: false });
    expect(Buffer.byteLength(result.log)).toBeLessThanOrEqual(1024);
  });
  it("reports spawn failures", async () => {
    const result = await runLatexProcess("lqb-command-does-not-exist", [], {
      env: process.env, timeoutMs: 2000, maxOutputBytes: 1024
    });
    expect(result.code).toBeNull();
    expect(result.log).toContain("ENOENT");
  });
  it("waits for timeout cleanup before permitting the next execution", async () => {
    const result = await runLatexProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      env: process.env, timeoutMs: 150, maxOutputBytes: 1024
    });
    expect(result.timedOut).toBe(true);
    expect(await runLatexProcess(process.execPath, ["-e", ""], {
      env: process.env, timeoutMs: 2000, maxOutputBytes: 1024
    })).toMatchObject({ code: 0, timedOut: false });
  });
});


it.skipIf(process.platform === "win32")("blocks new TeX work after failed cleanup and retries before spawning", async () => {
  const denied = Object.assign(new Error("signal denied"), { code: "EPERM" });
  const kill = vi.spyOn(process, "kill").mockImplementation(() => { throw denied; });
  try {
    const result = await runLatexProcess(process.execPath, ["-e", "console.log(process.pid); setInterval(()=>{},1000)"], {
      env: process.env, timeoutMs: 300, maxOutputBytes: 1024
    });
    groups.add(Number(result.log.split("\n")[0]));
    expect(result.log).toContain("signal denied");
    await expect(runLatexProcess(process.execPath, ["-e", ""], {
      env: process.env, timeoutMs: 2000, maxOutputBytes: 1024
    })).rejects.toThrow("signal denied");
  } finally {
    kill.mockRestore();
  }
  expect(await runLatexProcess(process.execPath, ["-e", ""], {
    env: process.env, timeoutMs: 2000, maxOutputBytes: 1024
  })).toMatchObject({ code: 0, timedOut: false });
});
