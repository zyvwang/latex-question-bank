import { _electron as electron, expect, type Page } from "@playwright/test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSampleBank } from "../server/bank-schema.js";
import type { Bank, QuestionItem } from "../shared/types.js";

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

const methodTags = [
  ["洛必达", "求极限", "泰勒展开", "等价无穷小", "夹逼准则", "单调有界", "中值定理", "连续性"],
  ["导数定义", "微分中值", "隐函数", "参数方程", "单调性", "极值", "曲率", "渐近线"],
  ["换元积分", "分部积分", "反常积分", "定积分", "面积", "弧长", "旋转体", "积分估计"],
  ["审敛法", "幂级数", "泰勒级数", "绝对收敛", "条件收敛", "收敛半径", "傅里叶", "余项"],
  ["偏导数", "全微分", "方向导数", "重积分", "曲线积分", "曲面积分", "极值", "梯度"],
  ["一阶方程", "二阶方程", "特征根", "常数变易", "齐次方程", "初值问题", "方程组", "稳定性"]
] as const;

async function main() {
  await rm(temporaryRoot, { recursive: true, force: true });
  await mkdir(screenshotDirectory, { recursive: true });
  try {
    await captureEditor();
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  console.log("README screenshots regenerated in docs/screenshots/.");
}

async function captureEditor() {
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
      page.getByRole("button", { name: /自编 1\.1/ })
    ).toContainText("洛必达");
    await expect(
      page.getByLabel("题目列表", { exact: true }).getByRole("heading", {
        name: "函数、极限与连续", exact: true
      })
    ).toBeVisible();
    await page.getByText("自编 1.2", { exact: true }).click();
    await expect(page.locator("#main-workspace").getByLabel("来源题号")).toHaveValue("自编 1.2");
    await settlePage(page);
    await capture(page, "main.png");
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
        moduleEditorPercent: 55
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
        tag: methodTags[chapterIndex][itemIndex]
      })
    )
  );
  return {
    ...base,
    chapters,
    books: [],
    imports: [],
    items
  };
}

function createQuestion({
  chapterId,
  chapterIndex,
  itemIndex,
  tag
}: {
  chapterId: string;
  chapterIndex: number;
  itemIndex: number;
  tag: string;
}): QuestionItem {
  const cycle = (chapterIndex * 8 + itemIndex) % 4;
  return {
    id: `demo-${chapterIndex + 1}-${itemIndex + 1}`,
    source: { bookId: null, label: `自编 ${chapterIndex + 1}.${itemIndex + 1}` },
    chapterId,
    chapterOrder: itemIndex + 1,
    tags: [tag],
    reviewPriority: (["must", "recheck", "skip", null] as const)[cycle] ?? null,
    reviewStatus:
      chapterIndex === 0 && itemIndex === 1 ? "pending" : "approved",
    solutionSource: "user",
    solutionRef: null,
    variantOf: null,
    importBatchId: null,
    importedAt: null,
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

await main();
