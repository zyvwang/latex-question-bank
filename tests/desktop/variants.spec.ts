import { hasTex } from '../fixtures/tex.js';
import {_electron as electron,expect,test} from '@playwright/test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createSampleBank} from '../../server/bank-schema.js';
import type {FamilyView,VariantOverview} from '../../shared/variants.js';
import type {PaperSnapshot} from '../../shared/papers.js';
const exec=promisify(execFile);
test('Agent proposes, user reviews, a version paper exports and a focused revision flushes on quit',async () => {
  test.setTimeout(120_000);
  const root=path.resolve('.tmp/playwright-variants');await rm(root,{recursive:true,force:true});const workspace=path.join(root,'workspace');const discovery=path.join(root,'agent.json');
  await mkdir(workspace,{recursive:true});const bank=createSampleBank();bank.items=[{...bank.items[0],questionTypes:['解答'],modules:{question:{tex:"设 $f(x)=x^2$，求 $f'(1)$。"},solution:{tex:"$f'(x)=2x$，故答案为 2。"},note:{tex:''}}}];await writeFile(path.join(workspace,'bank.json'),JSON.stringify(bank));
  const app=await electron.launch({args:['.'],env:{...process.env,LQB_WORKSPACE_DIR:workspace,LQB_APP_DATA_DIR:path.join(root,'app-data'),LQB_AGENT_DISCOVERY_FILE:discovery}});
  const cli=async (...args:string[]) => JSON.parse((await exec(process.execPath,[path.resolve('bin/lqb.mjs'),...args,'--json'],{cwd:workspace,env:{...process.env,LQB_AGENT_DISCOVERY_FILE:discovery},maxBuffer:16*1024*1024})).stdout);
  try {
    const page=await app.firstWindow();await page.getByRole('navigation',{name:'题库页面'}).getByRole('button',{name:'组卷',exact:true}).click();await page.locator('#variant-manager > summary').click();await page.getByLabel('开启本工作区版本管理').click();await expect(page.getByLabel('开启本工作区版本管理')).toBeChecked();
    await page.getByLabel('原题',{exact:true}).selectOption(bank.items[0].id);await page.getByText('确认原始题型并纳入').click();await expect(page.getByRole('heading',{name:/当前原题/})).toBeVisible();
    let o=await cli('variant','list') as VariantOverview;let v=await cli('variant','read',o.families[0].family.id) as FamilyView;
    const variantId='70000000-0000-4000-8000-000000000001';const manifestFile=path.join(root,'variant.json');
    await writeFile(manifestFile,JSON.stringify({familyId:v.family.id,revision:v.revision,bankRevision:o.bankRevision,rootFingerprint:v.rootFingerprint,variantId,content:{targetKind:'B',question:"设 $f(x)=x^2$，则 $f'(1)=$\\blank。",answer:'2',solution:"由 $f'(x)=2x$，得 $f'(1)=2$。"}}));
    const before=await readdir(path.join(workspace,'variants'));await cli('variant','propose','--file',manifestFile,'--dry-run');expect(await readdir(path.join(workspace,'variants'))).toEqual(before);
    await cli('variant','propose','--file',manifestFile);await expect(page.locator('#variant-manager').getByText('待审阅',{exact:true})).toBeVisible();await page.getByLabel(`勾选版本 ${variantId}`).check();await page.getByText('批准勾选版本').click();await expect(page.getByText('已批准',{exact:true})).toBeVisible();
    v=await cli('variant','read',v.family.id);const paperId='70000000-0000-4000-8000-000000000002';const paperFile=path.join(root,'paper.json');
    await writeFile(paperFile,JSON.stringify({schemaVersion:1,id:paperId,kind:'practice',title:'表达版本练习卷',mode:'manual',useVariants:true,counts:[0,1,0],assignments:[{number:1,ref:{kind:'variant',id:variantId,revision:v.rows[0].revision.id}}]}));
    const created=await cli('paper','create','--file',paperFile) as PaperSnapshot;expect(created.paper.slots[0].origin?.rootId).toBe(bank.items[0].id);
    if (hasTex()) {const output=await cli('paper','export',paperId);expect(output.ok).toBe(true);expect((await readFile(path.join(output.exportPath,'questions.pdf'))).subarray(0,4).toString()).toBe('%PDF');expect(await readFile(path.join(output.exportPath,'sources.md'),'utf8')).toContain(variantId);}
    await page.getByText('专门纠错：原始题型').click();await page.getByLabel('正确题型').selectOption('B');await page.getByLabel('纠错理由').fill('原始题型标记应为填空');page.once('dialog',d => d.accept());await page.getByText('确认纠错并标记待复核').click();await expect(page.getByText('待复核',{exact:true})).toBeVisible();
    o=await cli('variant','list');v=await cli('variant','read',v.family.id);expect(v.family.typeEpoch).toBe(2);expect(o.config.enabled).toBe(true);await page.getByLabel('开启本工作区版本管理').click();await expect(page.getByLabel('开启本工作区版本管理')).not.toBeChecked();if (hasTex()) expect((await cli('paper','export',paperId)).ok).toBe(true);await page.getByLabel('开启本工作区版本管理').click();await expect(page.getByLabel('开启本工作区版本管理')).toBeChecked();
    await page.getByRole('button',{name:'修订',exact:true}).click();const answer=page.getByRole('group',{name:'答案',exact:true}).locator('.cm-content');await answer.fill('2（退出前补充答案说明）');
    const child=app.process();await app.evaluate(({app}) => app.quit()).catch(() => undefined);await expect.poll(() => child.exitCode).not.toBeNull();
    const family=JSON.parse(await readFile(path.join(workspace,'variants',`family-${v.family.id}.json`),'utf8'));expect(family.versions[0].status).toBe('pending');expect(family.versions[0].history).toHaveLength(2);
    const revision=JSON.parse(await readFile(path.join(workspace,'variants',`revision-${family.versions[0].currentRevision}.json`),'utf8'));expect(revision.content.answer).toBe('2（退出前补充答案说明）');expect(JSON.parse(await readFile(path.join(workspace,'bank.json'),'utf8')).version).toBe(4);
  } finally {await app.evaluate(({app}) => app.exit(0)).catch(() => undefined);}
});
