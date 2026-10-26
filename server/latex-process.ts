import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { BoundedOutput } from "./bounded-output.js";

// Failed cleanup is retried before another TeX process can start.
const pendingCleanup = new Set<ChildProcess>();
const terminations = new WeakMap<ChildProcess, Promise<void>>();

export function terminateProcessTree(child: ChildProcess): Promise<void> {
  const existing = terminations.get(child);
  if (existing) return existing;
  const operation = terminateTree(child).finally(() => terminations.delete(child));
  terminations.set(child, operation);
  return operation;
}

async function terminateTree(child: ChildProcess) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    await taskkill(child);
    return;
  }
  const group = -child.pid;
  if (!signalGroup(group, "SIGTERM")) return;
  // The leader exiting does not mean its descendants have exited.
  for (let attempt = 0; attempt < 20; attempt++) {
    if (!signalGroup(group, 0)) return;
    await delay(50);
  }
  if (!signalGroup(group, "SIGKILL")) return;
  for (let attempt = 0; attempt < 20; attempt++) {
    if (!signalGroup(group, 0)) return;
    await delay(50);
  }
  throw new Error("LaTeX process group cleanup failed; remaining processes could not be confirmed stopped.");
}

function signalGroup(group: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(group, signal);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

function taskkill(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      windowsHide: true, stdio: "ignore"
    });
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve();
    };
    const timer = setTimeout(() => {
      killer.kill();
      finish(new Error("LaTeX taskkill cleanup timed out."));
    }, 2000);
    killer.on("error", (error) => finish(new Error(`LaTeX taskkill failed: ${error.message}`)));
    killer.on("close", (code) => {
      if (code === 0) finish();
      else finish(new Error(`LaTeX taskkill cleanup failed (exit ${code}).`));
    });
  });
}

export async function runLatexProcess(command: string, args: string[], options: {
  env: NodeJS.ProcessEnv;
  cwd?: string;
  timeoutMs: number;
  maxOutputBytes: number;
}): Promise<{ code: number | null; log: string; timedOut: boolean }> {
  for (const child of pendingCleanup) {
    await terminateProcessTree(child);
    pendingCleanup.delete(child);
  }
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: options.env, cwd: options.cwd, detached: process.platform !== "win32", windowsHide: true
    });
    const output = new BoundedOutput(options.maxOutputBytes);
    let settled = false;
    let timedOut = false;
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, log: output.toString(), timedOut });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      pendingCleanup.add(child);
      void terminateProcessTree(child).then(() => {
        pendingCleanup.delete(child);
      }, (error: unknown) => {
        output.append(`\n${error instanceof Error ? error.message : String(error)}`);
      }).finally(() => finish(null));
    }, options.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => output.append(chunk));
    child.stderr.on("data", (chunk: Buffer) => output.append(chunk));
    child.on("error", (error) => {
      output.append(`\n${error.message}`);
      if (!timedOut) finish(null);
    });
    child.on("close", (code) => {
      // Timeout owns completion until cleanup finishes, even if stdio closes earlier.
      if (!timedOut) finish(code);
    });
  });
}
