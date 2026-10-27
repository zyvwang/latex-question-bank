import { _electron as electron, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { createSampleBank } from "../server/bank-schema.js";
import type {
  Bank,
  QuestionAsset,
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
    await captureReview();
    await captureSettings();
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

async function captureReview() {
  const workspacePath = path.join(
    temporaryRoot,
    "review-workspace",
    "高等数学审阅演示库"
  );
  const appDataPath = path.join(temporaryRoot, "review-app-data");
  const screenshot = await createDemoScreenshot();
  await prepareRun(
    workspacePath,
    appDataPath,
    createReviewBank(screenshot.asset),
    [{ fileName: screenshot.asset.fileName, buffer: screenshot.buffer }]
  );
  const electronApp = await launchApp(workspacePath, appDataPath);
  try {
    const page = await electronApp.firstWindow();
    await setViewport(electronApp, page);
    await page
      .getByRole("navigation", { name: "题库页面" })
      .getByRole("button", { name: /待审阅/ })
      .click();
    await expect(page.getByText("待审阅 2 道")).toBeVisible();
    await expect(
      page.getByLabel("题目附件").getByRole("button", {
        name: "查看附件 截图 2026-10-26.png"
      })
    ).toBeVisible();    await expect(page.getByLabel("变式原题").getByRole("button")).toContainText(
      "自编 1.4"
    );
    await settlePage(page);
    await capture(page, "review.png");
  } finally {
    await closeApp(electronApp);
  }
}

async function captureSettings() {
  const workspacePath = path.join(
    temporaryRoot,
    "settings-workspace",
    "高等数学设置演示库"
  );
  const appDataPath = path.join(temporaryRoot, "settings-app-data");
  await prepareRun(workspacePath, appDataPath, createSettingsBank());
  const electronApp = await launchApp(workspacePath, appDataPath);
  try {
    const page = await electronApp.firstWindow();
    await setViewport(electronApp, page);
    await page.getByRole("button", { name: "题库设置" }).click();
    await expect(
      page.getByRole("heading", { name: "题库设置" })
    ).toBeVisible();
    await page
      .getByRole("heading", { name: "书目" })
      .scrollIntoViewIfNeeded();
    await expect(
      page.getByLabel("书目名称 高等数学讲义")
    ).toBeVisible();
    await expect(page.getByText("demo-book-batch")).toBeVisible();
    await settlePage(page);
    await capture(page, "settings.png");
  } finally {
    await closeApp(electronApp);
  }
}

async function prepareRun(
  workspacePath: string,
  appDataPath: string,
  bank: Bank,
  assets: Array<{ fileName: string; buffer: Buffer }> = []
) {
  await mkdir(workspacePath, { recursive: true });
  await mkdir(appDataPath, { recursive: true });
  if (assets.length > 0) {
    await mkdir(path.join(workspacePath, "assets"), { recursive: true });
  }
  for (const asset of assets) {
    await writeFile(
      path.join(workspacePath, "assets", asset.fileName),
      asset.buffer
    );
  }
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

function createReviewBank(asset: QuestionAsset): Bank {
  const base = createEditorBank();
  return {
    ...base,
    items: base.items.map((item) => {
      if (item.id === "demo-1-1") {
        return {
          ...item,
          source: { bookId: null, label: "截图 10-26" },
          reviewPriority: "must",
          reviewStatus: "pending" as const,
          variantOf: "demo-1-4",
          modules: {
            ...item.modules,
            question: {
              tex: "根据截图，求极限。\n\\begin{center}\n\\includegraphics[width=0.75\\linewidth]{assets/screenshot-demo.png}\n\\end{center}"
            }
          },
          assets: [asset]
        };
      }
      if (item.id === "demo-1-2") {
        return {
          ...item,
          reviewPriority: "recheck",
          reviewStatus: "pending" as const,
          variantOf: "demo-1-1"
        };
      }
      return item;
    })
  };
}

function createSettingsBank(): Bank {
  const base = createEditorBank();
  const book = {
    id: "book-demo",
    title: "高等数学讲义",
    filePath: "/Users/demo/Documents/高等数学讲义.pdf",
    fileHash: "a".repeat(64),
    answerBookPath: "/Users/demo/Documents/高等数学讲义答案.pdf",
    answerBookHash: "c".repeat(64),
    createdAt: timestamp,
    updatedAt: timestamp
  };
  return {
    ...base,
    books: [book],
    items: base.items.map((item, index) => ({
      ...item,
      source: {
        bookId: book.id,
        label: `${Math.floor(index / 8) + 1}.${(index % 8) + 1}`
      }
    })),
    imports: [
      {
        id: "demo-book-batch",
        createdAt: timestamp,
        note: "高等数学讲义整书导入",
        bookTitles: [book.title],
        newCount: base.items.length,
        updatedCount: 0,
        skippedCount: 0,
        conflictCount: 0,
        itemIds: base.items.map((item) => item.id),
        updatedItemIds: [],
        historySnapshot: null,
        status: "completed",
        undoneAt: null
      }
    ]
  };
}

async function createDemoScreenshot(): Promise<{
  asset: QuestionAsset;
  buffer: Buffer;
}> {
  const svg = `<svg width="960" height="600" xmlns="http://www.w3.org/2000/svg">
  <rect width="960" height="600" fill="#f4efe4"/>
  <rect x="40" y="36" width="880" height="528" rx="14" fill="#fffdf8" stroke="#d6cfc0" stroke-width="2"/>
  <text x="82" y="112" font-family="Georgia, serif" font-size="26" fill="#6b756f" letter-spacing="3">SCREENSHOT · EXAMPLE 2.3</text>
  <text x="82" y="184" font-family="Georgia, serif" font-size="30" fill="#23312b">Evaluate the following limit:</text>
  <text x="82" y="264" font-family="Georgia, serif" font-size="40" fill="#1d4f45">lim (sin 3x - 3x) / x³</text>
  <text x="82" y="322" font-family="Georgia, serif" font-size="28" fill="#42514a">x → 0</text>
  <rect x="82" y="380" width="796" height="2" fill="#e2dbce"/>
  <text x="82" y="436" font-family="Georgia, serif" font-size="22" fill="#6b756f">Scanned exercise page · synthetic demo attachment</text>
  <text x="82" y="482" font-family="Georgia, serif" font-size="22" fill="#6b756f">Use Taylor expansion to finish the review.</text>
  </svg>`;
  const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
  return {
    buffer,
    asset: {
      id: "asset-screenshot-demo",
      fileName: "screenshot-demo.png",
      originalName: "截图 2026-10-26.png",
      relativePath: "assets/screenshot-demo.png",
      mimeType: "image/png",
      size: buffer.byteLength,
      uploadedAt: timestamp,
      sha256: createHash("sha256").update(buffer).digest("hex")
    }
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
    topics: [tag],
    questionTypes: [(["解答", "选择", "填空", "证明"] as const)[cycle] ?? "解答"],
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
