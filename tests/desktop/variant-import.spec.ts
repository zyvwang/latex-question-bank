import { hasTex } from '../fixtures/tex.js';
import {_electron as electron,expect,test} from '@playwright/test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createSampleBank} from '../../server/bank-schema.js';
import type {FamilyView} from '../../shared/variants.js';
import type {PaperSnapshot} from '../../shared/papers.js';
const exec=promisify(execFile);
test('one joint import, human original/version review, version paper and both PDFs',async () => {
  test.setTimeout(120_000);
  const root=path.resolve('.tmp/playwright-variant-import');await rm(root,{recursive:true,force:true});const workspace=path.join(root,'workspace');const discovery=path.join(root,'agent.json');
  await mkdir(workspace,{recursive:true});const bank=createSampleBank();bank.items=[];await writeFile(path.join(workspace,'bank.json'),JSON.stringify(bank));
  const app=await electron.launch({args:['.'],env:{...process.env,LQB_WORKSPACE_DIR:workspace,LQB_APP_DATA_DIR:path.join(root,'app-data'),LQB_AGENT_DISCOVERY_FILE:discovery}});
  const cli=async (...args:string[]) => JSON.parse((await exec(process.execPath,[path.resolve('bin/lqb.mjs'),...args,'--json'],{cwd:workspace,env:{...process.env,LQB_AGENT_DISCOVERY_FILE:discovery},maxBuffer:16*1024*1024})).stdout);
  try {
    const page=await app.firstWindow();const nav=page.getByRole('navigation',{name:'题库页面'});
    await nav.getByRole('button',{name:'组卷',exact:true}).click();await page.locator('#variant-manager > summary').click();
    await expect(page.getByLabel('允许 Agent 自动纳管新题和指定旧题')).toBeDisabled();
    await page.getByLabel('开启本工作区版本管理').click();await expect(page.getByLabel('开启本工作区版本管理')).toBeChecked();await page.getByLabel('允许 Agent 自动纳管新题和指定旧题').click();await expect(page.getByLabel('允许 Agent 自动纳管新题和指定旧题')).toBeChecked();
    const ids=['82000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000003','82000000-0000-4000-8000-000000000004'];
    const file=path.join(root,'joint.json');await writeFile(file,JSON.stringify({schemaVersion:1,groups:[{operationId:ids[0],original:{kind:'new',manifest:{schemaVersion:1,questions:[{id:ids[1],questionTypes:['解答'],solutionSource:'agent',modules:{question:{tex:"设 $f(x)=x^2$，求 $f'(1)$。"},solution:{tex:"$f'(x)=2x$，故 $f'(1)=2$。"}}}]}},variants:[{id:ids[2],content:{targetKind:'B',question:"设 $f(x)=x^2$，则 $f'(1)=$\\blank。",answer:'2',solution:"$f'(x)=2x$，故 $f'(1)=2$。"}},{id:ids[3],content:{targetKind:'C',question:"设 $f(x)=x^2$，计算其在 $x=1$ 处的导数。",answer:'2',solution:"$f'(x)=2x$，代入 $x=1$ 得 2。"}}],refusals:[]}]}));
    const before=await readdir(path.join(workspace,'variants'));await cli('variant','import','--file',file,'--dry-run');expect(await readdir(path.join(workspace,'variants'))).toEqual(before);
    const imported=await cli('variant','import','--file',file);expect(imported.counts.succeeded).toBe(1);const result=imported.groups[0].result;expect(result.pendingCount).toBe(3);expect((await cli('variant','import-result',ids[0])).status).toBe('completed');
    await nav.getByRole('button',{name:/待审阅/}).click();await expect(page.getByRole('button',{name:'批准并下一题'})).toBeEnabled();await page.getByRole('button',{name:'批准并下一题'}).click();
    await nav.getByRole('button',{name:'组卷',exact:true}).click();await page.getByText('读取磁盘并核对结果').click();await page.getByLabel('原题族').selectOption(result.familyId);
    await expect(page.getByLabel(`勾选版本 ${ids[2]}`)).toBeVisible();await page.getByLabel(`勾选版本 ${ids[2]}`).check();await page.getByLabel(`勾选版本 ${ids[3]}`).check();await page.getByText('批准勾选版本').click();await expect(page.locator('#variant-manager').getByText('已批准',{exact:true})).toHaveCount(2);
    const v=await cli('variant','read',result.familyId) as FamilyView;expect(v.rows.every(r => r.eligible)).toBe(true);
    const paperFile=path.join(root,'paper.json');await writeFile(paperFile,JSON.stringify({schemaVersion:1,id:'82000000-0000-4000-8000-000000000005',kind:'practice',title:'联合录入版本验收',mode:'manual',useVariants:true,counts:[0,1,0],assignments:[{number:1,ref:{kind:'variant',id:ids[2],revision:v.rows[0].revision.id}}]}));
    const paper=await cli('paper','create','--file',paperFile) as PaperSnapshot;expect(paper.paper.slots[0].origin?.rootId).toBe(ids[1]);
    if (hasTex()) {const output=await cli('paper','export',paper.paper.id);expect(output.ok).toBe(true);for (const name of ['questions.pdf','full.pdf']) expect((await readFile(path.join(output.exportPath,name))).subarray(0,4).toString()).toBe('%PDF');}
    await page.setViewportSize({width:900,height:700});await page.locator('#variant-manager > summary').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(root,'authorization-narrow.png')});
  } finally {await app.evaluate(({app}) => app.exit(0)).catch(() => undefined);}
});
