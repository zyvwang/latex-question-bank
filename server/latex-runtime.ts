import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import type { CompileResult, TexStatus } from "../shared/types.js";
import { readAppState } from "./workspace-storage.js";
import {
  BoundedOutput,
  MAX_LATEX_LOG_BYTES,
  MAX_LATEX_PROBE_BYTES
} from "./bounded-output.js";
import {
  assertLatexExecutionSession,
  withLatexExecutionSlot,
  type LatexExecutionSession
} from "./latex-execution.js";

const TEX_DETECTION_CACHE_MS = 30_000;
let cachedTexStatus:
  | { key: string; expiresAt: number; value: TexStatus }
  | undefined;
let texDetectionInFlight:
  | { key: string; promise: Promise<TexStatus> }
  | undefined;

export async function compileLatex(
  texPath: string,
  cwd: string,
  timeoutMs = 45_000,
  session?: LatexExecutionSession
): Promise<CompileResult> {
  if (session) {
    // A document operation holds the slot across file preparation and export commit.
    assertLatexExecutionSession(session);
    return compileLatexExclusive(texPath, cwd, timeoutMs);
  }
  return withLatexExecutionSlot(() =>
    compileLatexExclusive(texPath, cwd, timeoutMs)
  );
}

async function compileLatexExclusive(
  texPath: string,
  cwd: string,
  timeoutMs: number
): Promise<CompileResult> {
  const texFile = path.basename(texPath);
  const pdfPath = path.join(cwd, texFile.replace(/\.tex$/i, ".pdf"));
  const texStatus = await detectTexInstallation();
  const latexmkCommand = texStatus.command;
  if (!texStatus.available || !latexmkCommand) {
    return {
      ok: false,
      texPath,
      log: `${texStatus.message}\n请安装 MacTeX、TeX Live 或 MiKTeX，并确保 latexmk 与 xelatex 可在 PATH 中使用。`
    };
  }
  const args = [
    "-xelatex",
    "-no-shell-escape",
    "-interaction=nonstopmode",
    "-halt-on-error",
    "-file-line-error",
    texFile
  ];

  return new Promise((resolve) => {
    const child = spawn(latexmkCommand, args, {
      cwd,
      env: createLatexProcessEnv(latexmkCommand),
      detached: process.platform !== "win32"
    });
    const output = new BoundedOutput(MAX_LATEX_LOG_BYTES);
    let settled = false;
    let timedOut = false;
    let terminationFallback: NodeJS.Timeout | undefined;
    const finish = (result: CompileResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (terminationFallback) clearTimeout(terminationFallback);
      resolve(result);
    };
    const timer = setTimeout(() => {
      if (!settled) {
        timedOut = true;
        terminateProcessTree(child);
        terminationFallback = setTimeout(() => {
          finish(timeoutResult(texPath, output, timeoutMs));
        }, 2_000);
        terminationFallback.unref();
      }
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      output.append(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output.append(chunk);
    });
    child.on("error", (error) => {
      if (timedOut) {
        finish(timeoutResult(texPath, output, timeoutMs));
        return;
      }
      finish({
        ok: false,
        texPath,
        log: summarizeLog(`${output.toString()}\n${error.message}`)
      });
    });
    child.on("close", async (code) => {
      if (settled) return;
      // close 已在期限内触发时先取消计时器；不要让随后的 PDF 可读性检查
      // 与超时回调竞争，把已经结束的进程误判成超时。
      clearTimeout(timer);
      if (timedOut) {
        finish(timeoutResult(texPath, output, timeoutMs));
        return;
      }
      const ok = code === 0 && (await fileExists(pdfPath));
      finish({
        ok,
        texPath,
        pdfPath: ok ? pdfPath : undefined,
        log: summarizeLog(output.toString())
      });
    });
  });
}

export async function detectTexInstallation(
  committedOverride?: string | null
): Promise<TexStatus> {
  const override = committedOverride === undefined
    ? (await readAppState()).texPathOverride ?? process.env.LQB_LATEXMK_PATH
    : committedOverride ?? process.env.LQB_LATEXMK_PATH;
  const key = detectionCacheKey(override);
  if (
    cachedTexStatus?.key === key &&
    cachedTexStatus.expiresAt > Date.now()
  ) {
    return cachedTexStatus.value;
  }
  if (texDetectionInFlight?.key === key) {
    return texDetectionInFlight.promise;
  }
  if (texDetectionInFlight) {
    await texDetectionInFlight.promise.catch(() => undefined);
    return detectTexInstallation(committedOverride);
  }

  const promise = detectTexInstallationUncached(override);
  texDetectionInFlight = { key, promise };
  try {
    const value = await promise;
    cachedTexStatus = {
      key,
      expiresAt: Date.now() + TEX_DETECTION_CACHE_MS,
      value
    };
    return value;
  } finally {
    if (texDetectionInFlight?.promise === promise) {
      texDetectionInFlight = undefined;
    }
  }
}

async function detectTexInstallationUncached(
  override: string | undefined
): Promise<TexStatus> {
  const candidates: Array<{ command: string; source: TexStatus["source"] }> = [
    ...(override ? [{ command: override, source: "override" as const }] : []),
    { command: "latexmk", source: "path" },
    ...commonLatexmkPaths().map((command) => ({ command, source: "common" as const }))
  ];

  for (const candidate of candidates) {
    const result = await probeLatexmk(candidate.command);
    if (result.available) {
      return {
        available: true,
        command: candidate.command,
        source: candidate.source,
        version: result.version,
        message: `已检测到 LaTeX：${candidate.command}`
      };
    }
  }
  return { available: false, source: "missing", message: "未检测到 latexmk。" };
}

export function createLatexProcessEnv(latexmkCommand: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const pathKey = getPathEnvKey(env);
  const existingPath = env[pathKey] ?? "";
  const latexmkDir =
    path.basename(latexmkCommand) === latexmkCommand ? "" : path.dirname(latexmkCommand);
  const extraDirs = [
    latexmkDir,
    ...(process.platform === "darwin" ? ["/Library/TeX/texbin"] : [])
  ].filter(Boolean);
  env[pathKey] = [...extraDirs, existingPath].filter(Boolean).join(path.delimiter);
  return env;
}

function terminateProcessTree(child: ChildProcess) {
  const pid = child.pid;
  if (!pid) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore"
    });
    killer.unref();
    return;
  }
  killUnixProcessTree(pid, "SIGTERM");
  const forceKillTimer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      killUnixProcessTree(pid, "SIGKILL");
    }
  }, 1_000);
  forceKillTimer.unref();
}

function killUnixProcessTree(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // The process already exited.
    }
  }
}

function summarizeLog(log: string): string {
  const lines = log.split(/\r?\n/);
  const important = lines.filter((line) =>
    /(^!|error|warning|undefined|missing|fatal|LaTeX|truncated|timed out)/i.test(line)
  );
  const summary = important.slice(-60).join("\n").trim();
  return summary || lines.slice(-80).join("\n").trim();
}

function commonLatexmkPaths(): string[] {
  if (process.platform === "darwin") {
    return [
      "/Library/TeX/texbin/latexmk",
      "/usr/local/texlive/2026/bin/universal-darwin/latexmk",
      "/usr/local/texlive/2025/bin/universal-darwin/latexmk",
      "/opt/homebrew/bin/latexmk",
      "/usr/local/bin/latexmk"
    ];
  }
  if (process.platform === "win32") {
    const years = ["2026", "2025", "2024", "2023"];
    return [
      ...years.map((year) => `C:\\texlive\\${year}\\bin\\windows\\latexmk.exe`),
      "C:\\Program Files\\MiKTeX\\miktex\\bin\\x64\\latexmk.exe",
      "C:\\Program Files (x86)\\MiKTeX\\miktex\\bin\\latexmk.exe"
    ];
  }
  return ["/usr/bin/latexmk", "/usr/local/bin/latexmk"];
}

function getPathEnvKey(env: NodeJS.ProcessEnv): string {
  if (process.platform !== "win32") return "PATH";
  return Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "Path";
}

function probeLatexmk(
  command: string,
  timeoutMs = 3_000
): Promise<{ available: boolean; version?: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, ["-version"], { env: createLatexProcessEnv(command) });
    const output = new BoundedOutput(MAX_LATEX_PROBE_BYTES, 8 * 1024);
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill("SIGTERM");
        resolve({ available: false });
      }
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      output.append(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output.append(chunk);
    });
    child.on("error", () => {
      if (settled) return;
      clearTimeout(timer);
      settled = true;
      resolve({ available: false });
    });
    child.on("close", (code) => {
      if (settled) return;
      clearTimeout(timer);
      settled = true;
      resolve({
        available: code === 0,
        version: output.toString().split(/\r?\n/).find(Boolean)
      });
    });
  });
}

function timeoutResult(
  texPath: string,
  output: BoundedOutput,
  timeoutMs: number
): CompileResult {
  return {
    ok: false,
    texPath,
    log: summarizeLog(
      `${output.toString()}\nLaTeX compile timed out after ${timeoutMs}ms.`
    )
  };
}

function detectionCacheKey(override: string | undefined): string {
  const pathKey = getPathEnvKey(process.env);
  return [
    process.platform,
    override ?? "",
    process.env.LQB_LATEXMK_PATH ?? "",
    process.env[pathKey] ?? ""
  ].join("\u0000");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
