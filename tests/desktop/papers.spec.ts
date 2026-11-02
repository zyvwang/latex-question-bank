import { _electron as electron, expect, test } from '@playwright/test';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createSampleBank } from '../../server/bank-schema.js';
import type { Paper } from '../../shared/papers.js';
import { installMessageBoxRecorder, readMessageBoxCalls } from '../fixtures/desktop-app.js';

async function launch(name: string) {
  const root = path.resolve(`.tmp/playwright-papers-${name}`);
  await rm(root,{ recursive: true,force: true });
  const workspace = path.join(root,'source'); const other = path.join(root,'other'); const data = path.join(root,'app-data');
  for (const dir of [workspace,other,data]) await mkdir(dir,{ recursive:true });
  for (const dir of [workspace,other]) await writeFile(path.join(dir,'bank.json'),JSON.stringify(createSampleBank()));
  await writeFile(path.join(data,'app-state.json'),JSON.stringify({ version:1,currentWorkspacePath:workspace,recentWorkspacePaths:[workspace,other] }));
  const app = await electron.launch({ args:['.'],env:{ ...process.env,LQB_WORKSPACE_DIR:'',LQB_APP_DATA_DIR:data } });
  const page = await app.firstWindow();
  await page.getByRole('navigation',{ name:'题库页面' }).getByRole('button',{ name:'组卷',exact:true }).click();
  await page.getByRole('button',{ name:'新建练习卷' }).click();
  await expect(page.getByLabel('标题',{ exact:true })).toBeVisible();
  const file = async () => path.join(workspace,'papers',(await readdir(path.join(workspace,'papers'))).find(f => f.endsWith('.json') && f !== 'settings.json')!);
  return { app,page,workspace,other,file };
}
test('persists the focused paper title on immediate quit and supports keyboard locking', async () => {
  const { app,page,workspace,file } = await launch('quit');
  try {
    await page.getByRole('button',{ name:'重抽未锁定题目' }).click();
    await expect(page.getByText('20 个题位待处理')).toBeVisible();
    const lock = page.getByRole('checkbox',{ name:'锁题' }).nth(16);
    await lock.focus(); await page.keyboard.press('Space'); await expect(lock).toBeChecked();
    const paperFile = await file();
    await page.getByLabel('标题',{ exact:true }).fill('直接退出前的草稿');
    const child = app.process();
    await app.evaluate(({ app }) => app.quit()).catch(() => undefined);
    await expect.poll(() => child.exitCode).not.toBeNull();
    const paper = JSON.parse(await readFile(paperFile,'utf8')) as Paper;
    expect(paper.title).toBe('直接退出前的草稿'); expect(paper.slots[16].locked).toBe(true);
    expect(paper.slots[16].snapshot?.id).toBe('sample-limit');
    expect(JSON.parse(await readFile(path.join(workspace,'bank.json'),'utf8')).version).toBe(4);
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined); }
});
test('flushes paper drafts when switching workspaces and reopens the saved snapshot', async () => {
  const { app,page,workspace,file } = await launch('switch');
  try {
    await page.getByLabel('标题',{ exact:true }).fill('切换前的练习卷');
    await page.getByRole('navigation',{ name:'题库页面' }).getByRole('button',{ name:'题库设置' }).click();
    await page.getByRole('button',{ name:'other 本地工作区',exact:true }).click();
    await expect(page.getByRole('button',{ name:'source 本地工作区',exact:true })).toBeEnabled();
    expect(JSON.parse(await readFile(await file(),'utf8')).title).toBe('切换前的练习卷');
    await page.getByRole('button',{ name:'source 本地工作区',exact:true }).click();
    await page.getByRole('navigation',{ name:'题库页面' }).getByRole('button',{ name:'组卷',exact:true }).click();
    await page.getByRole('button',{ name:/切换前的练习卷/ }).click();
    await expect(page.getByLabel('标题',{ exact:true })).toHaveValue('切换前的练习卷');
    expect((await readdir(path.join(workspace,'papers'))).some(f => f.endsWith('.json'))).toBe(true);
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined); }
});
test('blocks quit on a real paper revision conflict while preserving both drafts', async () => {
  const { app,page,file } = await launch('conflict');
  try {
    const paperFile = await file();
    const external = JSON.parse(await readFile(paperFile,'utf8')) as Paper;
    external.title = '外部试卷'; await writeFile(paperFile,JSON.stringify(external));
    await page.getByLabel('标题',{ exact:true }).fill('本地试卷');
    await expect(page.getByRole('alert')).toContainText('试卷已被修改');
    await installMessageBoxRecorder(app,0);
    await app.evaluate(({ app }) => app.quit()).catch(() => undefined);
    await expect.poll(() => readMessageBoxCalls(app)).toHaveLength(1);
    expect((await readMessageBoxCalls(app))[0].detail).toContain('试卷');
    expect(JSON.parse(await readFile(paperFile,'utf8')).title).toBe('外部试卷');
    await expect(page.getByLabel('标题',{ exact:true })).toHaveValue('本地试卷');
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined); }
});

test('scrolls the paper page with the pointer over a short question preview', async () => {
  const { app,page } = await launch('wheel');
  try {
    await page.getByRole('button',{ name:'重抽未锁定题目' }).click();
    await expect(page.getByText('20 个题位待处理')).toBeVisible();
    const scroller = page.getByRole('region',{ name:'组卷',exact:true });
    const preview = scroller.getByRole('article').nth(16).locator('[data-latex-preview]').first();
    await preview.scrollIntoViewIfNeeded();
    const box = await preview.boundingBox();
    expect(box).not.toBeNull();
    const initial = await scroller.evaluate(el => el.scrollTop);
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.wheel(0,240);
    await expect.poll(() => scroller.evaluate(el => el.scrollTop)).toBeGreaterThan(initial);
    const down = await scroller.evaluate(el => el.scrollTop);
    await preview.scrollIntoViewIfNeeded();
    const nextBox = await preview.boundingBox();
    await page.mouse.move(nextBox!.x + nextBox!.width / 2,nextBox!.y + nextBox!.height / 2);
    const beforeUp = await scroller.evaluate(el => el.scrollTop);
    expect(down).toBeGreaterThan(initial);
    await page.mouse.wheel(0,-180);
    await expect.poll(() => scroller.evaluate(el => el.scrollTop)).toBeLessThan(beforeUp);
    const article = scroller.getByRole('article').nth(16);
    await article.locator('summary').click();
    const solution = article.locator('[data-latex-preview]').nth(1);
    await solution.scrollIntoViewIfNeeded();
    const solutionBox = await solution.boundingBox();
    const beforeSolution = await scroller.evaluate(el => el.scrollTop);
    await page.mouse.move(solutionBox!.x + solutionBox!.width / 2,solutionBox!.y + solutionBox!.height / 2);
    await page.mouse.wheel(0,180);
    await expect.poll(() => scroller.evaluate(el => el.scrollTop)).toBeGreaterThan(beforeSolution);
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined); }
});
