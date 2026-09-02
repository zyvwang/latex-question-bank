import { _electron as electron, expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { Bank } from "../../shared/types.js";

const require = createRequire(import.meta.url);
const electronPath = require("electron") as string;

test("keeps one desktop instance and restores the existing window", async () => {
  const workspacePath = path.resolve(".tmp/playwright-single-instance-workspace");
  const appDataPath = path.resolve(".tmp/playwright-single-instance-app-data");
  await rm(workspacePath, { recursive: true, force: true });
  await rm(appDataPath, { recursive: true, force: true });

  const environment = {
    ...process.env,
    LQB_WORKSPACE_DIR: workspacePath,
    LQB_APP_DATA_DIR: appDataPath
  };
  const electronApp = await electron.launch({ args: ["."], env: environment });

  try {
    const page = await electronApp.firstWindow();
    await page.getByText("新增题目", { exact: true }).click();
    await page.getByLabel("原编号").fill("single-instance-save");
    await electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (!window) throw new Error("主窗口不存在。");
      const probe = { focusCalls: 0 };
      const focus = window.focus.bind(window);
      window.focus = () => {
        probe.focusCalls += 1;
        focus();
      };
      Object.assign(globalThis, { __lqbSingleInstanceProbe: probe });
      window.minimize();
    });

    const second = spawn(electronPath, ["."], {
      cwd: path.resolve("."),
      env: environment,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    second.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    second.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        second.kill("SIGKILL");
        reject(new Error("第二个 Electron 实例未在 10 秒内退出。"));
      }, 10_000);
      second.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      second.once("exit", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });

    expect(exitCode, stderr).toBe(0);
    expect(stdout).not.toContain("API server listening");
    await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      const probe = (globalThis as typeof globalThis & {
        __lqbSingleInstanceProbe?: { focusCalls: number };
      }).__lqbSingleInstanceProbe;
      return {
        windowCount: BrowserWindow.getAllWindows().length,
        minimized: window?.isMinimized() ?? true,
        visible: window?.isVisible() ?? false,
        focusCalls: probe?.focusCalls ?? 0
      };
    })).toEqual({
      windowCount: 1,
      minimized: false,
      visible: true,
      focusCalls: 1
    });

    await electronApp.evaluate(({ app }) => app.quit()).catch(() => undefined);
    await expect.poll(async () => {
      const saved = JSON.parse(
        await readFile(path.join(workspacePath, "bank.json"), "utf8")
      ) as Bank;
      return saved.items[0]?.sourceNumber;
    }).toBe("single-instance-save");
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  }
});
