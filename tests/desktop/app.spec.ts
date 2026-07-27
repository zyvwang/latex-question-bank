import { _electron as electron, expect, test } from "@playwright/test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createSampleBank } from "../../server/bank-schema.js";
import type { Bank, LegacyBank } from "../../shared/types.js";

test("starts in Setup, creates a workspace, and removes only its recent-list entry", async () => {
  const workspacePath = path.resolve(".tmp/playwright-setup-workspace");
  const appDataPath = path.resolve(".tmp/playwright-setup-app-data");
  await rm(workspacePath, { recursive: true, force: true });
  await rm(appDataPath, { recursive: true, force: true });

  const electronApp = await electron.launch({
    args: ["."],
    env: {
      ...process.env,
      LQB_APP_DATA_DIR: appDataPath,
      LQB_WORKSPACE_DIR: ""
    }
  });

  try {
    const page = await electronApp.firstWindow();
    await expect(page.getByText("建立你的第一个题库")).toBeVisible();
    await electronApp.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [selectedPath]
      });
    }, workspacePath);
    await page.getByRole("button", { name: "新建空白题库" }).click();
    await expect(page.getByText("当前工作区还没有题目")).toBeVisible();
    await expect.poll(async () => readFile(path.join(workspacePath, "bank.json"), "utf8"))
      .toContain('"version": 2');

    await page.getByRole("button", { name: "题库设置" }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "从列表移除工作区" }).click();
    await expect(page.getByText("建立你的第一个题库")).toBeVisible();
    await expect(readFile(path.join(workspacePath, "bank.json"), "utf8"))
      .resolves.toContain('"version": 2');
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  }
});

test("opens v1, saves the first edit as v2 on close, and restarts from v2", async () => {
  const workspacePath = path.resolve(".tmp/playwright-v1-workspace");
  const appDataPath = path.resolve(".tmp/playwright-v1-app-data");
  await rm(workspacePath, { recursive: true, force: true });
  await rm(appDataPath, { recursive: true, force: true });
  await mkdir(workspacePath, { recursive: true });
  await writeFile(
    path.join(workspacePath, "bank.json"),
    `${JSON.stringify(createLegacyDesktopBank(), null, 2)}\n`,
    "utf8"
  );

  const launchOptions = {
    args: ["."],
    env: {
      ...process.env,
      LQB_WORKSPACE_DIR: workspacePath,
      LQB_APP_DATA_DIR: appDataPath
    }
  };
  const electronApp = await electron.launch(launchOptions);

  try {
    const page = await electronApp.firstWindow();
    await expect(page.getByLabel("原编号")).toHaveValue("旧题 1");
    expect(JSON.parse(await readFile(path.join(workspacePath, "bank.json"), "utf8")).version)
      .toBe(1);
    await page.getByLabel("原编号").fill("旧题 1（已编辑）");

    const exitPromise = new Promise<void>((resolve) => {
      electronApp.process().once("exit", () => resolve());
    });
    await electronApp.evaluate(({ app }) => app.quit()).catch(() => undefined);
    await exitPromise;
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  }

  const savedBank = JSON.parse(
    await readFile(path.join(workspacePath, "bank.json"), "utf8")
  ) as Bank;
  expect(savedBank.version).toBe(2);
  expect(savedBank.items[0]).toMatchObject({
    sourceNumber: "旧题 1（已编辑）",
    masteryOptionId: null,
    errorReasonOptionIds: []
  });
  expect(
    JSON.parse(await readFile(path.join(workspacePath, "bank.json.bak"), "utf8")).version
  ).toBe(1);

  const restartedApp = await electron.launch(launchOptions);
  try {
    const restartedPage = await restartedApp.firstWindow();
    await expect(restartedPage.getByLabel("原编号")).toHaveValue("旧题 1（已编辑）");
  } finally {
    await restartedApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  }
});

test("persists an edited item in the packaged desktop runtime", async () => {
  const workspacePath = path.resolve(".tmp/playwright-desktop-workspace");
  const appDataPath = path.resolve(".tmp/playwright-app-data");
  await rm(workspacePath, { recursive: true, force: true });
  await rm(appDataPath, { recursive: true, force: true });

  const launchOptions = {
    args: ["."],
    env: {
      ...process.env,
      LQB_WORKSPACE_DIR: workspacePath,
      LQB_APP_DATA_DIR: appDataPath
    }
  };
  const electronApp = await electron.launch(launchOptions);

  try {
    const page = await electronApp.firstWindow();
    const browserWindow = await electronApp.browserWindow(page);
    await expect(page.getByText("当前工作区还没有题目")).toBeVisible();
    expect(await page.evaluate(() => Boolean(window.lqb))).toBe(true);
    const runtimePaths = await electronApp.evaluate(({ app }) => ({
      userData: app.getPath("userData"),
      sessionData: app.getPath("sessionData"),
      usesMockKeychain: app.commandLine.hasSwitch("use-mock-keychain")
    }));
    expect(path.resolve(runtimePaths.userData)).toBe(appDataPath);
    expect(path.resolve(runtimePaths.sessionData)).toBe(path.join(appDataPath, "session"));
    if (process.platform === "darwin") {
      expect(runtimePaths.usesMockKeychain).toBe(true);
    }
    await page.evaluate(() => {
      const testWindow = window as Window & { closeProbeCleanup?: () => void };
      testWindow.closeProbeCleanup = window.lqb?.onBeforeClose(async () => {
        document.body.dataset.closeProbe = "received";
      });
    });
    await browserWindow.evaluate((targetWindow) => {
      targetWindow.webContents.send("app:before-close");
    });
    await expect.poll(() => page.evaluate(() => document.body.dataset.closeProbe)).toBe("received");
    await page.evaluate(() => {
      const testWindow = window as Window & { closeProbeCleanup?: () => void };
      testWindow.closeProbeCleanup?.();
      delete testWindow.closeProbeCleanup;
    });
    await page.getByText("新增题目", { exact: true }).click();
    await page.getByLabel("原编号").fill("desktop-close-save");
    const exitPromise = new Promise<void>((resolve) => {
      electronApp.process().once("exit", () => resolve());
    });
    await electronApp.evaluate(({ app }) => app.quit()).catch(() => undefined);
    await exitPromise;
    await expect
      .poll(async () => {
        const saved = JSON.parse(
          await readFile(path.join(workspacePath, "bank.json"), "utf8")
        ) as Bank;
        return saved.items[0]?.sourceNumber;
      })
      .toBe("desktop-close-save");
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  }

  const restartedApp = await electron.launch(launchOptions);
  try {
    const restartedPage = await restartedApp.firstWindow();
    await expect(restartedPage.getByLabel("原编号")).toHaveValue("desktop-close-save");
  } finally {
    await restartedApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  }
});

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

test("keeps MathJax previews working in the editor and heatmap", async () => {
  const workspacePath = path.resolve(".tmp/playwright-preview-workspace");
  const appDataPath = path.resolve(".tmp/playwright-preview-app-data");
  await rm(workspacePath, { recursive: true, force: true });
  await rm(appDataPath, { recursive: true, force: true });
  await mkdir(workspacePath, { recursive: true });
  const previewBank = createSampleBank();
  previewBank.items[0].modules.question.tex =
    `\\[${Array.from({ length: 48 }, (_, index) => `x_{${index + 1}}`).join(" + ")}\\]`;
  await writeFile(
    path.join(workspacePath, "bank.json"),
    `${JSON.stringify(previewBank, null, 2)}\n`,
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
    await expect
      .poll(() => page.locator('[role="tabpanel"] mjx-container').count())
      .toBeGreaterThan(0);
    const editorPreview = page.locator('[role="tabpanel"] [data-latex-preview]');
    await expect
      .poll(() => editorPreview.evaluate(
        (element) => element.scrollWidth - element.clientWidth
      ))
      .toBeGreaterThan(0);
    await expect
      .poll(() => editorPreview.evaluate((element) => {
        element.scrollLeft = 0;
        element.dispatchEvent(new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaX: 120
        }));
        return element.scrollLeft;
      }))
      .toBeGreaterThan(0);
    await expect
      .poll(() => editorPreview.evaluate((element) => {
        element.scrollLeft = 0;
        element.dispatchEvent(new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaY: 120,
          shiftKey: true
        }));
        return element.scrollLeft;
      }))
      .toBeGreaterThan(0);

    await page.getByText("示例 2", { exact: true }).click();
    await expect(page.getByLabel("原编号")).toHaveValue("示例 2");
    await expect
      .poll(() => page.locator('[role="tabpanel"] mjx-container').count())
      .toBeGreaterThan(0);
    await page.getByRole("tab", { name: /解析/ }).click();
    await expect
      .poll(() => page.locator('[role="tabpanel"] mjx-container').count())
      .toBeGreaterThan(0);

    await page.getByRole("button", { name: "热力图" }).click();
    await expect(page.getByRole("heading", { name: "热力图" })).toBeVisible();
    await expect(page.locator("[data-heatmap-cell]")).toHaveCount(2);
    await expect
      .poll(() => page.locator('[aria-label="题目预览"] mjx-container').count())
      .toBeGreaterThan(0);
    const heatmapPreview = page.locator(
      '[aria-label="题目预览"] [data-latex-preview]'
    );
    await expect
      .poll(() => heatmapPreview.evaluate(
        (element) => element.scrollWidth - element.clientWidth
      ))
      .toBeGreaterThan(0);
    await expect
      .poll(() => heatmapPreview.evaluate((element) => {
        element.scrollLeft = 0;
        element.dispatchEvent(new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaX: 120
        }));
        return element.scrollLeft;
      }))
      .toBeGreaterThan(0);

    await page.locator('[data-heatmap-cell="sample-linear-algebra"]').hover();
    await expect(page.getByRole("heading", { name: "示例 2" })).toBeVisible();
    await expect
      .poll(() => page.locator('[aria-label="题目预览"] mjx-container').count())
      .toBeGreaterThan(0);
    await page.getByRole("tab", { name: /解析/ }).click();
    await expect
      .poll(() => page.locator('[aria-label="题目预览"] mjx-container').count())
      .toBeGreaterThan(0);
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  }
});

test("keeps a 1000-item production heatmap responsive without virtualization", async () => {
  const workspacePath = path.resolve(".tmp/playwright-heatmap-workspace");
  const appDataPath = path.resolve(".tmp/playwright-heatmap-app-data");
  await rm(workspacePath, { recursive: true, force: true });
  await rm(appDataPath, { recursive: true, force: true });
  await mkdir(workspacePath, { recursive: true });
  await writeFile(
    path.join(workspacePath, "bank.json"),
    `${JSON.stringify(createLargeHeatmapBank(), null, 2)}\n`,
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
    const enteredAt = Date.now();
    await page.getByRole("button", { name: "热力图" }).click();
    await expect(page.locator("[data-heatmap-cell]")).toHaveCount(1000);
    expect(Date.now() - enteredAt).toBeLessThan(5000);
    await expect(page.locator('[aria-label="题目预览"]')).toHaveCount(1);

    const gridPane = page.getByRole("region", {
      name: "题目热力图滚动区域"
    });
    await gridPane.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect
      .poll(() => gridPane.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);

    const switchedAt = Date.now();
    await page.getByRole("button", { name: "错误原因", exact: true }).click();
    await expect(page.locator("[data-heatmap-mode='errorReason']")).toHaveCount(1000);
    expect(Date.now() - switchedAt).toBeLessThan(3000);

    await page.locator('[data-heatmap-cell="large-10-100"]').hover();
    await expect(page.getByRole("heading", { name: "10-100" })).toBeVisible();
    await expect
      .poll(() => page.locator('[aria-label="题目预览"] mjx-container').count())
      .toBeGreaterThan(0);
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
      targetWindow.webContents.send("app:before-close");
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

interface MessageBoxCall {
  message: string;
  detail: string;
  buttons: string[];
}

type MessageBoxRecorder = typeof globalThis & {
  __closeMessageBoxCalls?: MessageBoxCall[];
};

async function installMessageBoxRecorder(
  electronApp: Awaited<ReturnType<typeof electron.launch>>,
  response: number
) {
  await electronApp.evaluate(({ dialog }, chosen) => {
    const store = globalThis as typeof globalThis & {
      __closeMessageBoxCalls?: Array<{
        message: string;
        detail: string;
        buttons: string[];
      }>;
    };
    store.__closeMessageBoxCalls = [];
    dialog.showMessageBox = (async (
      _window: unknown,
      options: { message?: string; detail?: string; buttons?: string[] }
    ) => {
      store.__closeMessageBoxCalls?.push({
        message: options?.message ?? "",
        detail: options?.detail ?? "",
        buttons: options?.buttons ?? []
      });
      return { response: chosen, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  }, response);
}

async function installHangingMessageBoxRecorder(
  electronApp: Awaited<ReturnType<typeof electron.launch>>
) {
  await electronApp.evaluate(({ dialog }) => {
    const store = globalThis as typeof globalThis & {
      __closeMessageBoxCalls?: Array<{
        message: string;
        detail: string;
        buttons: string[];
      }>;
    };
    store.__closeMessageBoxCalls = [];
    dialog.showMessageBox = (async (
      _window: unknown,
      options: { message?: string; detail?: string; buttons?: string[] }
    ) => {
      store.__closeMessageBoxCalls?.push({
        message: options?.message ?? "",
        detail: options?.detail ?? "",
        buttons: options?.buttons ?? []
      });
      // 永不 resolve:对话框一直开着,测试才能在这段窗口里发第二次关闭检查。
      await new Promise<void>(() => undefined);
      return { response: 0, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  });
}

async function readMessageBoxCalls(
  electronApp: Awaited<ReturnType<typeof electron.launch>>
): Promise<MessageBoxCall[]> {
  // 应用若已经退出,evaluate 会抛连接错误。这里吞掉并返回空数组,好让断言报出
  // 「没有弹出对话框」这个真正的症状,而不是一句 target has been closed。
  return electronApp
    .evaluate(() => (globalThis as MessageBoxRecorder).__closeMessageBoxCalls ?? [])
    .catch(() => []);
}

function createConflictingDesktopBank(): Bank {
  const base = createSampleBank();
  const template = base.items[0];
  const timestamp = "2026-07-26T08:00:00.000Z";
  // 两道题都落在未分类;原编号唯一性按章节判定,chapterId 同为 null 即同章节。
  return {
    ...base,
    chapters: [],
    items: [
      {
        ...template,
        id: "conflict-target",
        sourceNumber: "",
        chapterId: null,
        chapterOrder: 1,
        createdAt: timestamp,
        updatedAt: timestamp
      },
      {
        ...template,
        id: "conflict-owner",
        sourceNumber: "冲突编号",
        chapterId: null,
        chapterOrder: 2,
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ]
  };
}

function createLegacyDesktopBank(): LegacyBank {
  const timestamp = "2026-07-26T08:00:00.000Z";
  return {
    version: 1,
    settings: {
      preamble: "",
      pageSize: "a4",
      spacing: { item: "1em", module: "0.5em" }
    },
    items: [
      {
        id: "legacy-desktop-item",
        order: 1,
        sourceNumber: "旧题 1",
        chapter: "旧章节",
        tags: ["旧标签"],
        star: 5,
        modules: {
          question: { tex: "求 $1+1$。" },
          solution: { tex: "$2$。" },
          note: { tex: "" }
        },
        assets: [],
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ]
  };
}

function createLargeHeatmapBank(): Bank {
  const base = createSampleBank();
  const chapters = Array.from({ length: 10 }, (_, index) => ({
    id: `large-chapter-${index + 1}`,
    name: `性能章节 ${index + 1}`,
    order: index + 1
  }));
  const template = base.items[0];
  const items = chapters.flatMap((chapter) =>
    Array.from({ length: 100 }, (_, index) => ({
      ...template,
      id: `large-${chapter.order}-${index + 1}`,
      sourceNumber: `${chapter.order}-${index + 1}`,
      chapterId: chapter.id,
      chapterOrder: index + 1,
      modules: {
        question: {
          tex: `性能题 $x_{${chapter.order},${index + 1}}$。`
        },
        solution: { tex: `答案为 $${chapter.order + index + 1}$。` },
        note: { tex: "" }
      }
    }))
  );
  return { ...base, chapters, items };
}
