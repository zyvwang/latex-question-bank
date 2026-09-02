import { _electron as electron, expect, type Page } from "@playwright/test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSampleBank } from "../server/bank-schema.js";
import type {
  Bank,
  MasteryHistoryEntry,
  MasteryHistoryItemState,
  QuestionItem
} from "../shared/types.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = path.join(projectRoot, ".tmp", "readme-screenshots");
const screenshotDirectory = path.join(projectRoot, "docs", "screenshots");
const viewport = { width: 1470, height: 891 } as const;
const timestamp = "2026-09-02T08:30:00.000Z";

const editorChapterDefinitions = [
  ["limits", "函数、极限与连续"],
  ["derivatives", "一元函数微分学"],
  ["integrals", "一元函数积分学"],
  ["series", "无穷级数"],
  ["multivariable", "多元函数微积分"],
  ["equations", "微分方程"]
] as const;

const heatmapChapterDefinitions = [
  ["limits", "函数、极限与连续", 13],
  ["derivatives", "一元函数微分学", 4],
  ["integrals", "一元函数积分学", 19],
  ["series", "无穷级数", 7],
  ["multivariable", "多元函数微积分", 15],
  ["equations", "微分方程", 11]
] as const;

const methodTags = [
  ["洛必达", "求极限", "泰勒展开", "等价无穷小", "夹逼准则", "单调有界", "中值定理", "连续性"],
  ["导数定义", "微分中值", "隐函数", "参数方程", "单调性", "极值", "曲率", "渐近线"],
  ["换元积分", "分部积分", "反常积分", "定积分", "面积", "弧长", "旋转体", "积分估计"],
  ["审敛法", "幂级数", "泰勒级数", "绝对收敛", "条件收敛", "收敛半径", "傅里叶", "余项"],
  ["偏导数", "全微分", "方向导数", "重积分", "曲线积分", "曲面积分", "极值", "梯度"],
  ["一阶方程", "二阶方程", "特征根", "常数变易", "齐次方程", "初值问题", "方程组", "稳定性"]
] as const;

const masteryIds = [
  "mastery-easy",
  "mastery-challenging",
  "mastery-hard"
] as const;

async function main() {
  await rm(temporaryRoot, { recursive: true, force: true });
  await mkdir(screenshotDirectory, { recursive: true });
  try {
    await captureEditorAndHistory();
    await captureHeatmap();
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  console.log("README screenshots regenerated in docs/screenshots/.");
}

async function captureEditorAndHistory() {
  const workspacePath = path.join(
    temporaryRoot,
    "editor-workspace",
    "高等数学演示库"
  );
  const appDataPath = path.join(temporaryRoot, "editor-app-data");
  await prepareRun(workspacePath, appDataPath, createEditorBank());
  const electronApp = await launchApp(workspacePath, appDataPath);
  try {
    const page = await electronApp.firstWindow();
    await setViewport(electronApp, page);
    await expect(
      page.getByLabel("题库导航").getByRole("heading", { name: "题目" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "1 自编 1.1" })
    ).toContainText("洛必达");
    await page.getByText("自编 1.2", { exact: true }).click();
    await expect(page.getByLabel("原编号")).toHaveValue("自编 1.2");
    await settlePage(page);
    await capture(page, "main.png");

    await page.getByRole("button", { name: "题库设置" }).click();
    const historyHeading = page.getByRole("heading", { name: "掌握历史" });
    await expect(historyHeading).toBeVisible();
    await historyHeading.scrollIntoViewIfNeeded();
    await expect(page.getByText("九月第一轮复习", { exact: true })).toBeVisible();
    await settlePage(page);
    await capture(page, "history.png");
  } finally {
    await closeApp(electronApp);
  }
}

async function captureHeatmap() {
  const workspacePath = path.join(
    temporaryRoot,
    "heatmap-workspace",
    "高等数学演示库"
  );
  const appDataPath = path.join(temporaryRoot, "heatmap-app-data");
  await prepareRun(workspacePath, appDataPath, createHeatmapBank());
  const electronApp = await launchApp(workspacePath, appDataPath);
  try {
    const page = await electronApp.firstWindow();
    await setViewport(electronApp, page);
    await page.getByRole("button", { name: "热力图" }).click();
    await page.getByRole("button", { name: "掌握程度", exact: true }).click();
    await expect(page.getByRole("heading", { name: "热力图" })).toBeVisible();
    await expect(page.getByText("69 道题，按章节与章内题序排列。")).toBeVisible();
    await expect(page.locator('[data-heatmap-mode="mastery"]')).toHaveCount(69);
    await settlePage(page);
    await capture(page, "heatmap.png");
  } finally {
    await closeApp(electronApp);
  }
}

async function prepareRun(
  workspacePath: string,
  appDataPath: string,
  bank: Bank
) {
  await mkdir(workspacePath, { recursive: true });
  await mkdir(appDataPath, { recursive: true });
  await writeFile(
    path.join(workspacePath, "bank.json"),
    `${JSON.stringify(bank, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(appDataPath, "app-state.json"),
    `${JSON.stringify({
      version: 1,
      recentWorkspacePaths: [],
      uiLayout: {
        questionSidebarWidth: 320,
        questionSidebarCollapsed: false,
        moduleEditorPercent: 55,
        heatmapPreviewWidth: 440,
        heatmapPreviewCollapsed: false
      }
    }, null, 2)}\n`,
    "utf8"
  );
}

async function launchApp(workspacePath: string, appDataPath: string) {
  return electron.launch({
    args: [projectRoot],
    env: {
      ...process.env,
      LQB_WORKSPACE_DIR: workspacePath,
      LQB_APP_DATA_DIR: appDataPath
    }
  });
}

async function closeApp(
  electronApp: Awaited<ReturnType<typeof electron.launch>>
) {
  const childProcess = electronApp.process();
  if (childProcess.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => {
    childProcess.once("exit", () => resolve());
  });
  await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  await exited;
}

async function setViewport(
  electronApp: Awaited<ReturnType<typeof electron.launch>>,
  page: Page
) {
  const browserWindow = await electronApp.browserWindow(page);
  await browserWindow.evaluate((window, size) => {
    window.setContentSize(size.width, size.height);
  }, viewport);
  await expect.poll(() => page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight
  }))).toEqual(viewport);
}

async function settlePage(page: Page) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(400);
}

async function capture(page: Page, fileName: string) {
  const image = await page.screenshot({
    path: path.join(screenshotDirectory, fileName),
    animations: "disabled",
    caret: "hide",
    scale: "css"
  });
  const width = image.readUInt32BE(16);
  const height = image.readUInt32BE(20);
  if (width !== viewport.width || height !== viewport.height) {
    throw new Error(
      `${fileName} was ${width}x${height}; expected ${viewport.width}x${viewport.height}.`
    );
  }
}

function createEditorBank(): Bank {
  const base = createSampleBank();
  const chapters = editorChapterDefinitions.map(([id, name], index) => ({
    id: `chapter-${id}`,
    name,
    order: index + 1
  }));
  const items = chapters.flatMap((chapter, chapterIndex) =>
    Array.from({ length: 8 }, (_, itemIndex) =>
      createQuestion({
        chapterId: chapter.id,
        chapterIndex,
        itemIndex,
        tag: methodTags[chapterIndex][itemIndex],
        masteryOptionId: [
          "mastery-easy",
          "mastery-challenging",
          null,
          "mastery-hard"
        ][(chapterIndex * 8 + itemIndex) % 4],
        errorReasonOptionIds: editorErrorReasons(chapterIndex * 8 + itemIndex)
      })
    )
  );
  return {
    ...base,
    chapters,
    items,
    masteryHistory: createMasteryHistory(base, items)
  };
}

function createHeatmapBank(): Bank {
  const base = createSampleBank();
  const random = createRandom(20260902);
  const chapters = heatmapChapterDefinitions.map(([id, name], index) => ({
    id: `chapter-${id}`,
    name,
    order: index + 1
  }));
  const items = chapters.flatMap((chapter, chapterIndex) =>
    Array.from(
      { length: heatmapChapterDefinitions[chapterIndex][2] },
      (_, itemIndex) => {
        const roll = random();
        const easyCutoff = [0.44, 0.57, 0.38, 0.49, 0.41, 0.52][chapterIndex];
        const masteryOptionId = roll < easyCutoff
          ? masteryIds[0]
          : roll < easyCutoff + 0.36
            ? masteryIds[1]
            : masteryIds[2];
        return createQuestion({
          chapterId: chapter.id,
          chapterIndex,
          itemIndex,
          tag: "复习题",
          masteryOptionId,
          errorReasonOptionIds: []
        });
      }
    )
  );
  return {
    ...base,
    chapters,
    items,
    masteryOptions: base.masteryOptions.map((option) => ({
      ...option,
      pattern: "solid"
    })),
    masteryHistory: []
  };
}

function createQuestion({
  chapterId,
  chapterIndex,
  itemIndex,
  tag,
  masteryOptionId,
  errorReasonOptionIds
}: {
  chapterId: string;
  chapterIndex: number;
  itemIndex: number;
  tag: string;
  masteryOptionId: string | null;
  errorReasonOptionIds: string[];
}): QuestionItem {
  return {
    id: `demo-${chapterIndex + 1}-${itemIndex + 1}`,
    sourceNumber: `自编 ${chapterIndex + 1}.${itemIndex + 1}`,
    chapterId,
    chapterOrder: itemIndex + 1,
    tags: [tag],
    masteryOptionId,
    errorReasonOptionIds,
    modules: {
      question: { tex: questionText(chapterIndex, itemIndex) },
      solution: {
        tex: `先整理已知条件，再使用相应方法计算。\n\\[\n\\text{演示解答：结果随参数 }${itemIndex + 1}\\text{ 确定。}\n\\]`
      },
      note: {
        tex: itemIndex % 2 === 0 ? "复习时注意定义域、端点和等号成立条件。" : ""
      }
    },
    assets: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function questionText(chapterIndex: number, itemIndex: number): string {
  const parameter = itemIndex + 1;
  const templates = [
    `求极限 $\\displaystyle\\lim_{x\\to 0}\\frac{\\sin(${parameter}x)-${parameter}x}{x^3}$。`,
    `设 $f(x)=x^{${parameter + 1}}e^{-x}$，求其在区间 $[0,+\\infty)$ 上的最大值。`,
    `计算 $\\displaystyle\\int_0^1 x^{${parameter}}\\ln(1+x)\\,dx$。`,
    `判断级数 $\\displaystyle\\sum_{k=1}^{\\infty}\\frac{(-1)^{k-1}}{k^{1+1/${parameter + 1}}}$ 的敛散性。`,
    `求曲面 $z=x^2+${parameter}y^2$ 在点 $(1,1,${parameter + 1})$ 处的切平面。`,
    `求微分方程 $y'+${parameter}y=e^{-x}$ 满足 $y(0)=1$ 的特解。`
  ];
  if (chapterIndex === 0 && itemIndex === 0) {
    return "设 $a_n=\\dfrac{3}{2}\\int_0^{\\frac{2n}{n+1}}x^{n-1}\\sqrt{1+x^n}\\,dx$，求 $\\displaystyle\\lim_{n\\to\\infty}na_n$。";
  }
  return templates[chapterIndex];
}

function editorErrorReasons(index: number): string[] {
  return [
    [],
    ["error-method"],
    ["error-calculation"],
    ["error-knowledge"]
  ][index % 4] ?? [];
}

function createMasteryHistory(
  bank: Bank,
  items: QuestionItem[]
): MasteryHistoryEntry[] {
  const historyDates = [
    ["2026-08-05", "基础概念复习"],
    ["2026-08-12", "极限与微分专题"],
    ["2026-08-19", "积分与级数专题"],
    ["2026-08-26", "综合训练"],
    ["2026-09-02", "九月第一轮复习"]
  ] as const;
  return historyDates.map(([localDate, name], historyIndex) => ({
    id: `history-${localDate}`,
    localDate,
    name,
    createdAt: `${localDate}T08:00:00.000Z`,
    updatedAt: `${localDate}T10:${String(10 + historyIndex * 7).padStart(2, "0")}:00.000Z`,
    masteryOptions: structuredClone(bank.masteryOptions),
    errorReasonOptions: structuredClone(bank.errorReasonOptions),
    itemStates: Object.fromEntries(
      items.map((item, itemIndex) => [
        item.id,
        historyItemState(itemIndex, historyIndex)
      ])
    )
  }));
}

function historyItemState(
  itemIndex: number,
  historyIndex: number
): MasteryHistoryItemState {
  const cycle = (itemIndex + historyIndex) % 4;
  return {
    masteryOptionId: [
      "mastery-easy",
      "mastery-challenging",
      "mastery-hard",
      null
    ][cycle],
    errorReasonOptionIds: cycle === 0
      ? []
      : [["error-method"], ["error-calculation"], ["error-knowledge"]][cycle - 1]
  };
}

function createRandom(seed: number) {
  return () => {
    seed += 0x6d2b79f5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

await main();
