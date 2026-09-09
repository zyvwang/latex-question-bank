import { validPng } from "../fixtures/images.js";
import { _electron as electron, expect, test } from "@playwright/test";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Bank } from "../../shared/types.js";

const product = "LaTeX Question Bank";
const directory = process.platform === "darwin"
  ? (process.arch === "arm64" ? "mac-arm64" : "mac")
  : "win-unpacked";
const executablePath = process.platform === "darwin"
  ? path.resolve("release", directory, `${product}.app`, "Contents", "MacOS", product)
  : path.resolve("release", directory, `${product}.exe`);

test("packaged application loads bundled resources and persists edits through quit and restart", async ({ playwright: _playwright }, testInfo) => {
  expect(["darwin", "win32"]).toContain(process.platform);
  await access(executablePath);
  const root = await mkdtemp(path.join(os.tmpdir(), "lqb-packaged-"));
  const workspace = path.join(root, "bank");
  await mkdir(workspace);
  const inheritedEnv = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const env: Record<string, string> = { ...inheritedEnv, LQB_APP_DATA_DIR: path.join(root, "app-data"), LQB_WORKSPACE_DIR: "" };
  delete env.LQB_DEV_SERVER_URL;
  const launchOptions = { executablePath, args: [], cwd: root, env };
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  const errors: string[] = [];
  const logs: string[] = [];
  async function launch() {
    const instance = await electron.launch(launchOptions);
    app = instance;
    instance.process().stdout?.on("data", (data: Buffer) => logs.push(data.toString()));
    instance.process().stderr?.on("data", (data: Buffer) => logs.push(data.toString()));
    expect(await instance.evaluate(({ app }) => app.isPackaged)).toBe(true);
    expect(await instance.evaluate(({ app }) => app.getAppPath())).toContain("app.asar");
    await instance.context().tracing.start({ screenshots: true, snapshots: true });
    const page = await instance.firstWindow();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
    });
    return page;
  }
  try {
    let page = await launch();
    await expect(page.getByText("建立你的第一个题库")).toBeVisible();
    await app!.evaluate(({ dialog }, target) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] });
    }, workspace);
    await page.getByRole("button", { name: "体验示例题库" }).click();
    await expect(page.getByLabel("原编号")).toBeVisible();
    await expect.poll(() => page.locator('[role="tabpanel"] mjx-container').count()).toBeGreaterThan(0);
    await page.locator('input[type="file"]').setInputFiles({
      name: "pixel.png", mimeType: "image/png",
      buffer: validPng
    });
    await expect(page.getByText("图片已插入当前模块。", { exact: true })).toBeVisible();
    await page.getByLabel("原编号").fill("packaged-save");
    await app!.context().tracing.stop({ path: testInfo.outputPath("first-session.zip") });
    const closing = app!.waitForEvent("close");
    await app!.evaluate(({ app }) => app.quit()).catch(() => undefined);
    await closing;
    app = undefined;
    const saved = JSON.parse(await readFile(path.join(workspace, "bank.json"), "utf8")) as Bank;
    expect(saved.items[0].sourceNumber).toBe("packaged-save");
    expect(saved.items[0].assets).toHaveLength(1);
    await access(path.join(workspace, saved.items[0].assets[0].relativePath));
    page = await launch();
    await expect(page.getByLabel("原编号")).toHaveValue("packaged-save");
    await expect.poll(() => page.locator('[role="tabpanel"] mjx-container').count()).toBeGreaterThan(0);
    expect(errors).toEqual([]);
    await app!.context().tracing.stop({ path: testInfo.outputPath("restart.zip") });
  } catch (error) {
    if (app) {
      const page = app.windows()[0];
      await page?.screenshot({ path: testInfo.outputPath("failure.png") }).catch(() => undefined);
      await app.context().tracing.stop({ path: testInfo.outputPath("failure.zip") }).catch(() => undefined);
    }
    throw error;
  } finally {
    if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
    await testInfo.attach("application-log", { body: logs.join(""), contentType: "text/plain" });
    await rm(root, { recursive: true, force: true });
  }
});
