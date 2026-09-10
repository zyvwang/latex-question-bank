import { _electron as electron, expect as baseExpect, type Page } from "@playwright/test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { once } from "node:events";
import { performance } from "node:perf_hooks";
import { createSampleBank } from "../server/bank-schema.js";
import type { Bank } from "../shared/types.js";

const expect = baseExpect.configure({ timeout: 30_000 });
const viewport = { width: 1470, height: 891 };
type ProbeWindow = Window & { sidebarProbe: { tasks: number[]; observer: PerformanceObserver } };

function createBank(count: number): Bank {
  const bank = createSampleBank();
  const chapters = Array.from({ length: 10 }, (_, index) => ({
    id: `benchmark-chapter-${index}`, name: `性能章节 ${index + 1}`, order: index + 1
  }));
  return {
    ...bank, chapters,
    items: Array.from({ length: count }, (_, index) => ({
      ...bank.items[0], id: `benchmark-${index}`, sourceNumber: `性能题 ${index + 1}`,
      chapterId: chapters[Math.floor(index / (count / 10))].id,
      chapterOrder: index % (count / 10) + 1,
      tags: [index % 10 === 0 ? "基准命中" : "普通题", "求极限"],
      modules: {
        question: { tex: `求极限 $\\lim_{x\\to 0}\\frac{\\sin x}{x}$，第 ${index + 1} 题。` },
        solution: { tex: "由等价无穷小可得 $1$。" }, note: { tex: "合成性能数据。" }
      }
    }))
  };
}

async function painted(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

async function measure(page: Page, action: () => Promise<unknown>) {
  await page.evaluate(() => {
    const probe = (window as unknown as ProbeWindow).sidebarProbe;
    probe.observer.takeRecords();
    probe.tasks.length = 0;
  });
  const start = performance.now();
  await action();
  await painted(page);
  const elapsedMs = performance.now() - start;
  const longTasks = await page.evaluate(() => {
    const probe = (window as unknown as ProbeWindow).sidebarProbe;
    return [...probe.tasks, ...probe.observer.takeRecords().map((entry) => entry.duration)];
  });
  return {
    elapsedMs: Math.round(elapsedMs), longTasks: longTasks.length,
    longestTaskMs: Math.round(Math.max(0, ...longTasks))
  };
}

async function run(root: string, count: number, sample: number) {
  const directory = path.join(root, `${count}-${sample}`);
  const workspacePath = path.join(directory, "workspace");
  await mkdir(workspacePath, { recursive: true });
  const content = JSON.stringify(createBank(count));
  await writeFile(path.join(workspacePath, "bank.json"), content);
  const app = await electron.launch({
    args: ["."], env: {
      ...process.env, LQB_DEV_SERVER_URL: "", LQB_WORKSPACE_DIR: workspacePath,
      LQB_APP_DATA_DIR: path.join(directory, "app-data")
    }
  });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      const tasks: number[] = [];
      const observer = new PerformanceObserver((list) => {
        tasks.push(...list.getEntries().map((entry) => entry.duration));
      });
      observer.observe({ type: "longtask", buffered: true });
      (window as unknown as ProbeWindow).sidebarProbe = { tasks, observer };
    });
    const loadStart = performance.now();
    await page.reload();
    const rows = page.locator("[data-question-id]");
    await expect(rows).toHaveCount(count, { timeout: 30_000 });
    await expect(page.locator(".cm-content")).toBeVisible();
    await painted(page);
    const loadMs = Math.round(performance.now() - loadStart);
    const dom = await page.evaluate(() => ({
      all: document.querySelectorAll("*").length,
      sidebar: document.querySelector('[aria-label="题目列表"]')?.querySelectorAll("*").length ?? 0,
      loadLongTasks: (window as unknown as ProbeWindow).sidebarProbe.tasks
    }));
    const search = page.getByRole("textbox", { name: "搜索题目" });
    const filter = await measure(page, async () => {
      await search.fill("基准命中");
      await expect(rows).toHaveCount(count / 10);
    });
    const clearSearch = await measure(page, async () => {
      await search.fill(""); await expect(rows).toHaveCount(count);
    });
    const switchItem = await measure(page, async () => {
      await page.locator("#question-nav-benchmark-1").click();
      await expect(page.getByLabel("原编号", { exact: true })).toHaveValue("性能题 2");
    });
    const scroll = await measure(page, async () => {
      await page.getByLabel("题目列表", { exact: true }).evaluate(async (element) => {
        const frameDeltas: number[] = [];
        let previous = performance.now();
        for (let frame = 1; frame <= 60; frame++) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => {
            const now = performance.now(); frameDeltas.push(now - previous); previous = now;
            element.scrollTop = (element.scrollHeight - element.clientHeight) * frame / 60;
            resolve();
          }));
        }
        element.setAttribute("data-benchmark-frame-max", String(Math.max(...frameDeltas)));
      });
    });
    const maxScrollFrameMs = await page.getByLabel("题目列表", { exact: true })
      .getAttribute("data-benchmark-frame-max");
    const responsePromise = page.waitForResponse((response) =>
      response.url().endsWith("/api/bank") && response.request().method() === "PUT");
    const editAndSave = await measure(page, async () => {
      const editor = page.locator(".cm-content");
      await editor.click(); await editor.press("End"); await editor.pressSequentially(" benchmark");
      const response = await responsePromise;
      if (!response.ok()) throw new Error(`Save failed: ${response.status()}`);
      await response.finished();
      await expect(page.getByText("已保存", { exact: true })).toBeVisible();
    });
    const saveResponse = await responsePromise;
    const timing = saveResponse.request().timing();
    return {
      count, sample, bankBytes: Buffer.byteLength(content), loadMs, dom,
      filter, clearSearch, switchItem,
      scroll: { ...scroll, maxFrameMs: Math.round(Number(maxScrollFrameMs)) },
      editAndSave, saveHttpMs: Math.round(timing.responseEnd - timing.requestStart)
    };
  } finally {
    const child = app.process();
    if (child.exitCode === null) {
      const exited = once(child, "exit");
      await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
      await exited;
    }
  }
}

await mkdir(path.resolve(".tmp"), { recursive: true });
const root = await mkdtemp(path.resolve(".tmp/sidebar-benchmark-"));
try {
  const results = [];
  for (const count of [1000, 5000]) {
    for (const sample of [1, 2, 3]) {
      const result = await run(root, count, sample);
      results.push(result);
      console.error(`Measured ${count} questions, sample ${sample}.`);
    }
  }
  console.log(JSON.stringify({
    environment: { platform: process.platform, arch: process.arch, node: process.version,
      cpu: os.cpus()[0]?.model, memoryGiB: Math.round(os.totalmem() / 2 ** 30), viewport },
    method: "Production Electron renderer reload, 3 samples per size, no CPU throttling. Timings include Playwright actions/assertions and two paint frames; editAndSave includes 500ms debounce. Scroll is 60 animation frames, not native wheel input. HTTP timing includes transport and server work.",
    results
  }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 3 });
}
