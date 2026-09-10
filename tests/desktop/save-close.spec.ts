import { _electron as electron, expect, test } from "@playwright/test";
import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createSampleBank } from "../../server/bank-schema.js";
import type { Bank } from "../../shared/types.js";
import { installMessageBoxRecorder, installHangingMessageBoxRecorder, readMessageBoxCalls, createConflictingDesktopBank } from "../fixtures/desktop-app.js";

test("pauses on a real disk conflict and blocks close without overwriting either version", async () => {
  const workspacePath = path.resolve(
    ".tmp/playwright-save-conflict-workspace"
  );
  const appDataPath = path.resolve(
    ".tmp/playwright-save-conflict-app-data"
  );
  await rm(workspacePath, { recursive: true, force: true });
  await rm(appDataPath, { recursive: true, force: true });
  await mkdir(workspacePath, { recursive: true });
  const initialBank = createSampleBank();
  const bankPath = path.join(workspacePath, "bank.json");
  await writeFile(
    bankPath,
    `${JSON.stringify(initialBank, null, 2)}\n`,
    "utf8"
  );

  const electronApp = await electron.launch({
    args: ["."],
    env: {
      ...process.env,
      LQB_WORKSPACE_DIR: workspacePath,
      LQB_APP_DATA_DIR: appDataPath
    }
  });

  try {
    const page = await electronApp.firstWindow();
    await expect(page.getByLabel("原编号")).toHaveValue("示例 1");
    const externalBank = {
      ...initialBank,
      settings: {
        ...initialBank.settings,
        preamble: `${initialBank.settings.preamble}\n% external edit`
      }
    };
    await writeFile(
      bankPath,
      `${JSON.stringify(externalBank, null, 2)}\n`,
      "utf8"
    );

    await page.getByLabel("原编号").fill("desktop-local-conflict");
    await page.getByLabel("原编号").press("Tab");
    await expect(page.getByRole("dialog", {
      name: "题库保存冲突"
    })).toBeVisible();
    await page.getByRole("button", { name: "暂时关闭" }).click();

    await page.getByLabel("原编号").fill("desktop-local-latest");
    await page.getByLabel("原编号").press("Tab");
    await page.waitForTimeout(800);
    const diskAfterFurtherEditing = JSON.parse(
      await readFile(bankPath, "utf8")
    ) as Bank;
    expect(diskAfterFurtherEditing.items[0].sourceNumber).toBe("示例 1");
    expect(diskAfterFurtherEditing.settings.preamble).toContain(
      "% external edit"
    );

    await installMessageBoxRecorder(electronApp, 0);
    await electronApp.evaluate(({ app }) => app.quit()).catch(() => undefined);
    await expect.poll(() => readMessageBoxCalls(electronApp)).toHaveLength(1);
    const [dialog] = await readMessageBoxCalls(electronApp);
    expect(dialog.detail).toContain("题库已被其他程序修改");
    await expect(page.getByRole("button", {
      name: "保存冲突 · 处理"
    })).toBeVisible();
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  }
});

test("blocks the quit and explains why when a focused draft fails validation", async () => {
  const workspacePath = path.resolve(".tmp/playwright-conflict-workspace");
  const appDataPath = path.resolve(".tmp/playwright-conflict-app-data");
  const bankPath = path.join(workspacePath, "bank.json");
  await rm(workspacePath, { recursive: true, force: true });
  await rm(appDataPath, { recursive: true, force: true });
  await mkdir(workspacePath, { recursive: true });
  await writeFile(
    bankPath,
    `${JSON.stringify(createConflictingDesktopBank(), null, 2)}\n`,
    "utf8"
  );

  const electronApp = await electron.launch({
    args: ["."],
    env: {
      ...process.env,
      LQB_WORKSPACE_DIR: workspacePath,
      LQB_APP_DATA_DIR: appDataPath
    }
  });

  try {
    const page = await electronApp.firstWindow();
    await expect(page.getByLabel("原编号")).toHaveValue("");

    // 对话框是模态的,真弹出来会把测试挂到超时;换成记录调用参数的桩。
    await installMessageBoxRecorder(electronApp, 0);

    // 同章节(都在未分类)已存在「冲突编号」,这里输入后不失焦、直接退出。
    await page.getByLabel("原编号").fill("冲突编号");
    await electronApp.evaluate(({ app }) => app.quit()).catch(() => undefined);

    await expect.poll(() => readMessageBoxCalls(electronApp)).toHaveLength(1);
    const [dialog] = await readMessageBoxCalls(electronApp);
    expect(dialog.message).toBe("最后的修改未能保存。");
    expect(dialog.detail).toContain("原编号“冲突编号”在当前章节中已被使用");
    expect(dialog.buttons).toEqual(["返回继续编辑", "放弃未保存修改"]);

    // 选了「返回继续编辑」:窗口留着,应用内也说明了原因,磁盘没有被改写。
    await expect(page.getByText(/在当前章节中已被使用/)).toBeVisible();
    const kept = JSON.parse(await readFile(bankPath, "utf8")) as Bank;
    expect(kept.items[0].sourceNumber).toBe("");

    // 换成「放弃未保存修改」,退出必须真的发生,否则用户会被自己的编辑困住。
    await installMessageBoxRecorder(electronApp, 1);
    const exitPromise = new Promise<void>((resolve) => {
      electronApp.process().once("exit", () => resolve());
    });
    await page.getByLabel("原编号").fill("冲突编号");
    await electronApp.evaluate(({ app }) => app.quit()).catch(() => undefined);
    await exitPromise;
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  }

  const finalBank = JSON.parse(await readFile(bankPath, "utf8")) as Bank;
  expect(finalBank.items[0].sourceNumber).toBe("");
});

test("shows only one unsaved dialog when a second close response arrives", async () => {
  const workspacePath = path.resolve(".tmp/playwright-double-dialog-workspace");
  const appDataPath = path.resolve(".tmp/playwright-double-dialog-app-data");
  await rm(workspacePath, { recursive: true, force: true });
  await rm(appDataPath, { recursive: true, force: true });
  await mkdir(workspacePath, { recursive: true });
  await writeFile(
    path.join(workspacePath, "bank.json"),
    `${JSON.stringify(createConflictingDesktopBank(), null, 2)}\n`,
    "utf8"
  );

  const electronApp = await electron.launch({
    args: ["."],
    env: {
      ...process.env,
      LQB_WORKSPACE_DIR: workspacePath,
      LQB_APP_DATA_DIR: appDataPath
    }
  });

  try {
    const page = await electronApp.firstWindow();
    const browserWindow = await electronApp.firstWindow().then(() =>
      electronApp.browserWindow(page)
    );
    await expect(page.getByLabel("原编号")).toHaveValue("");

    // 对话框挂住不返回,模拟用户还没点按钮的那段时间 —— 缺陷正是在这段窗口里。
    await installHangingMessageBoxRecorder(electronApp);

    await page.getByLabel("原编号").fill("冲突编号");
    await electronApp.evaluate(({ app }) => app.quit()).catch(() => undefined);
    await expect.poll(() => readMessageBoxCalls(electronApp)).toHaveLength(1);

    // 第一个对话框还挂着,再来一次关闭检查。重新填草稿是为了让这次回复同样是
    // {ok:false},走到弹框那一支。
    await page.getByLabel("原编号").fill("冲突编号");
    await page.evaluate(() => {
      document.body.dataset.secondCloseProbe = "";
      const testWindow = window as Window & { closeProbeCleanup?: () => void };
      testWindow.closeProbeCleanup = window.lqb?.onBeforeClose(async () => {
        document.body.dataset.secondCloseProbe = "received";
      });
    });
    await browserWindow.evaluate((targetWindow) => {
      targetWindow.webContents.send("app:before-close", "test-probe");
    });
    await expect
      .poll(() => page.evaluate(() => document.body.dataset.secondCloseProbe))
      .toBe("received");
    // 探针跑完 preload 才发回复,再留一点余量给主进程处理。
    await page.waitForTimeout(500);

    // closeCheckPending 若等到 await 之后才置 false,这里会是 2 个叠起来的对话框。
    expect(await readMessageBoxCalls(electronApp)).toHaveLength(1);
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  }
});

test("ignores a late success from a timed-out close round", async () => {
  const workspacePath = path.resolve(".tmp/playwright-late-close-workspace");
  const appDataPath = path.resolve(".tmp/playwright-late-close-app-data");
  await rm(workspacePath, { recursive: true, force: true });
  await rm(appDataPath, { recursive: true, force: true });
  await mkdir(workspacePath, { recursive: true });
  await writeFile(path.join(workspacePath, "bank.json"), JSON.stringify(createConflictingDesktopBank()));
  const electronApp = await electron.launch({ args: ["."], env: {
    ...process.env, LQB_WORKSPACE_DIR: workspacePath, LQB_APP_DATA_DIR: appDataPath
  } });
  try {
    const page = await electronApp.firstWindow();
    await expect(page.getByLabel("原编号")).toBeVisible();
    await installMessageBoxRecorder(electronApp, 0);
    await electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      const original = window.webContents.send.bind(window.webContents);
      Object.assign(globalThis, { closeRoundIds: [] as string[] });
      window.webContents.send = (channel, ...args) => {
        if (channel === "app:before-close") {
          (globalThis as typeof globalThis & { closeRoundIds: string[] }).closeRoundIds.push(String(args[0]));
          return;
        }
        original(channel, ...args);
      };
      window.close();
    });
    await expect.poll(() => readMessageBoxCalls(electronApp), { timeout: 15_000 }).toHaveLength(1);
    await electronApp.evaluate(({ BrowserWindow, ipcMain }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.close();
      const ids = (globalThis as typeof globalThis & { closeRoundIds: string[] }).closeRoundIds;
      ipcMain.emit("app:close-response", {
        sender: window.webContents, senderFrame: window.webContents.mainFrame
      }, { ok: true, requestId: ids[0] });
    });
    expect(await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    expect(await electronApp.evaluate(() => (globalThis as typeof globalThis & { closeRoundIds: string[] }).closeRoundIds.length)).toBe(2);
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  }
});
