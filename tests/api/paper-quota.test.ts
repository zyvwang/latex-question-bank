import { mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApiApp } from '../../server/index.js';
import { getAgentToken } from '../../server/agent-auth.js';
import { appDataDir } from '../../server/app-state.js';
import { createSampleBank } from '../../server/bank-schema.js';
import { makeSlots, slotProblems } from '../../shared/papers.js';
import { quotaRequirements } from '../../shared/paper-topics.js';
import { listenLocal, request } from '../fixtures/api-server.js';

const workspacePath = path.resolve('.tmp/quota-api');
let url: string;
const id = '20000000-0000-4000-8000-000000000001';
const appOp = (action:string,body:Record<string,unknown> = {},status=200) => request(url).post(`/api/papers/${action}`).send({workspacePath,...body}).expect(status);
const agentGet = (route:string) => request(url).get(`/api/agent/papers${route}`).query({ workspacePath }).set('Authorization',`Bearer ${getAgentToken()}`).expect(200);
const agentPost = (route:string,body:Record<string,unknown>,status=200) => request(url).post(`/api/agent/papers${route}`).set('Authorization',`Bearer ${getAgentToken()}`).send({workspacePath,...body}).expect(status);
const catalog = async () => (await agentGet('/catalog')).body;
const propose = async (dryRun=false) => {
  const c = await catalog();
  const entries = quotaRequirements('quota').map((groupId,i) => ({ itemId:`q${i}`,groupId,reason:'按主要解题任务归类' }));
  return agentPost('/classifications/propose',{ schemaVersion:1,bankRevision:c.bankRevision,topicsRevision:c.topicsRevision,entries,dryRun });
};
async function approveAll() {
  await propose(); const data = (await appOp('topics-read')).body;
  await appOp('topics-review',{bankRevision:data.bankRevision,topicsRevision:data.revision,entries:data.rows.map((r:{item:{id:string}}) => ({itemId:r.item.id,action:'approve'}))});
}
async function create(extra:Record<string,unknown> = {},status=200) {
  const c = await catalog();
  return agentPost('/create',{schemaVersion:1,id,kind:'mock',seed:'quota',mode:'auto',quotaEnabled:true,bankRevision:c.bankRevision,topicsRevision:c.topicsRevision,...extra},status);
}
beforeEach(async () => {
  await Promise.all([workspacePath,appDataDir].map(p => rm(p,{recursive:true,force:true})));
  await mkdir(workspacePath,{recursive:true});
  const bank = createSampleBank();
  const template = makeSlots('mock');
  bank.chapters = ['calculus','linear','probability'].map((id,i) => ({id,name:id,order:i+1}));
  bank.items = template.map((s,i) => ({...structuredClone(bank.items[0]),id:`q${i}`,source:null,chapterId:s.subject,chapterOrder:i+1,topics:[quotaRequirements('quota')[i]],questionTypes:[{choice:'选择',blank:'填空',answer:'解答'}[s.section]]}));
  await writeFile(path.join(workspacePath,'bank.json'),JSON.stringify(bank));
  url = await listenLocal(createApiApp());
  await request(url).post('/api/workspaces/open').send({workspacePath}).expect(200);
});
async function mapSubjects() {
  const s = (await appOp('settings')).body;
  s.settings.chapters = {calculus:'calculus',linear:'linear',probability:'probability'};
  await appOp('save-settings',s);
}
describe('strict quotas and authenticated agent papers', () => {
  it('keeps catalog and dry-runs free of paper-directory writes and enforces token',async () => {
    await request(url).get('/api/agent/papers/catalog').query({workspacePath}).expect(401);
    await catalog(); await propose(true);
    await create({dryRun:true});
    expect(await readdir(workspacePath)).not.toContain('papers');
    expect((await appOp('topics-read')).body.rows.every((r:{approved:unknown}) => r.approved === null)).toBe(true);
  });
  it('enables quotas by default on new mock papers and never on practice papers',async () => {
    await mapSubjects();
    const c = await catalog();
    const base = {schemaVersion:1,id,seed:'quota',mode:'auto',dryRun:true,bankRevision:c.bankRevision,topicsRevision:c.topicsRevision};
    expect((await agentPost('/create',{...base,kind:'mock'},200)).body.paper.quota.enabled).toBe(true);
    expect((await agentPost('/create',{...base,kind:'mock',quotaEnabled:false},200)).body.paper.quota.enabled).toBe(false);
    expect((await agentPost('/create',{...base,kind:'practice'},200)).body.paper.quota.enabled).toBe(false);
  });
  it('requires user confirmation, then fills exact quotas without altering bank or original topics',async () => {
    await mapSubjects(); const raw = await readFile(path.join(workspacePath,'bank.json'),'utf8');
    await propose();
    expect((await create({dryRun:true})).body.report.problems.filter(Boolean)).toHaveLength(22);
    const data = (await appOp('topics-read')).body;
    await appOp('topics-review',{ bankRevision:data.bankRevision,topicsRevision:data.revision,entries:data.rows.map((r:{item:{id:string}}) => ({itemId:r.item.id,action:'approve'})) });
    const result = (await create()).body;
    expect(result.paper.version).toBe(3); expect(slotProblems(result.paper).some(Boolean)).toBe(false);
    expect(result.report.quotas.reduce((v:number,r:{target:number}) => v+r.target,0)).toBe(22);
    expect(result.paper.slots.map((s:{topic:{groupId:string}}) => s.topic.groupId)).toEqual(quotaRequirements('quota'));
    expect(await readFile(path.join(workspacePath,'bank.json'),'utf8')).toBe(raw);
    expect((await appOp('list')).body.warnings).toEqual([]);
    await create({},409);
    await agentPost('/classifications/review',{},404);
  });
  it('rejects wrong manual choices and locks atomically; dry-run and failed replacements do not alter files',async () => {
    await mapSubjects(); await approveAll(); const result = (await create()).body;
    const c = await catalog(); const file = path.join(workspacePath,'papers',`${id}.json`); const raw = await readFile(file,'utf8');
    await agentPost(`/${id}/replace`,{revision:result.revision,bankRevision:c.bankRevision,topicsRevision:c.topicsRevision,assignments:[{number:1,itemId:'q21'}]},400);
    expect(await readFile(file,'utf8')).toBe(raw);
    const pool = (await request(url).get(`/api/agent/papers/${id}/candidates`).query({workspacePath,slot:1}).set('Authorization',`Bearer ${getAgentToken()}`).expect(200)).body;
    expect(pool.items.every((q:{primaryGroup:string}) => q.primaryGroup === result.paper.slots[0].requiredGroup)).toBe(true);
    const draft = result.paper; draft.slots[0].locked = true;
    const saved = (await appOp('save',{id,revision:result.revision,paper:draft})).body;
    await agentPost(`/${id}/replace`,{revision:saved.revision,bankRevision:c.bankRevision,topicsRevision:c.topicsRevision,assignments:[{number:1}]},400);
    const dry = (await agentPost(`/${id}/generate`,{revision:saved.revision,bankRevision:c.bankRevision,topicsRevision:c.topicsRevision,dryRun:true})).body;
    expect(dry.paper.slots[0]).toEqual(draft.slots[0]); expect((await agentGet(`/${id}`)).body.revision).toBe(saved.revision);
    await agentPost(`/${id}/generate`,{revision:result.revision,bankRevision:c.bankRevision,topicsRevision:c.topicsRevision},409);
  });
  it('marks semantic edits stale while keeping old paper snapshots independently valid',async () => {
    await mapSubjects(); await approveAll(); const original = (await create()).body;
    const bank = (await request(url).get('/api/bank')).body;
    bank.bank.items[0].modules.question.tex += '新条件';
    await request(url).put('/api/bank').send({workspacePath,baseRevision:bank.revision,bank:bank.bank}).expect(200);
    const rows = (await appOp('topics-read')).body.rows;
    expect(rows.find((r:{item:{id:string}}) => r.item.id === 'q0').state).toBe('stale');
    expect(slotProblems((await agentGet(`/${id}`)).body.paper).filter(Boolean)).toHaveLength(0);
    const c = await catalog();
    const dry = (await agentPost(`/${id}/generate`,{revision:original.revision,bankRevision:c.bankRevision,topicsRevision:c.topicsRevision,dryRun:true})).body;
    expect(dry.report.problems.filter(Boolean)).toHaveLength(1);
    expect(dry.paper.slots.map((s:{requiredGroup:string}) => s.requiredGroup)).toEqual(original.paper.slots.map((s:{requiredGroup:string}) => s.requiredGroup));
  });
  it('does not partially approve stale batches and rejects revision or invalid proposals',async () => {
    await propose(); const data = (await appOp('topics-read')).body;
    const bank = (await request(url).get('/api/bank')).body; bank.bank.items[0].topics = ['new'];
    await request(url).put('/api/bank').send({workspacePath,baseRevision:bank.revision,bank:bank.bank}).expect(200);
    const c = await catalog();
    await appOp('topics-review',{bankRevision:c.bankRevision,topicsRevision:data.revision,entries:[{itemId:'q1',action:'approve'},{itemId:'q0',action:'approve'}]},400);
    const after = (await appOp('topics-read')).body; expect(after.revision).toBe(data.revision); expect(after.rows[1].approved).toBeNull();
    await agentPost('/classifications/propose',{schemaVersion:1,bankRevision:c.bankRevision,topicsRevision:'wrong',entries:[{itemId:'q0',groupId:'C01',reason:'理由'}]},409);
    await agentPost('/classifications/propose',{schemaVersion:1,bankRevision:c.bankRevision,topicsRevision:c.topicsRevision,entries:[{itemId:'q0',groupId:'bad',reason:'理由'}]},400);
  });
  it('reads v1 without migration writes and rejects symlink metadata while isolating corrupt files',async () => {
    const p = (await appOp('create',{kind:'mock'})).body;
    const legacy = {...p.paper,version:1}; delete legacy.quota;
    await writeFile(path.join(workspacePath,'papers',`${p.paper.id}.json`),JSON.stringify(legacy));
    const read = (await appOp('read',{id:p.paper.id})).body; expect(read.paper.version).toBe(3);
    expect(JSON.parse(await readFile(path.join(workspacePath,'papers',`${p.paper.id}.json`),'utf8')).version).toBe(1);
    await writeFile(path.join(workspacePath,'papers','topics.json'),'{bad');
    expect((await appOp('topics-read')).body.warning).toContain('损坏');
    await request(url).get('/api/bank').expect(200); expect((await appOp('list')).body.warnings).toEqual([]);
    await rm(path.join(workspacePath,'papers','topics.json'));
    const outside = path.resolve('.tmp/quota-outside.json'); await writeFile(outside,'{}');
    await symlink(outside,path.join(workspacePath,'papers','topics.json'));
    await appOp('topics-read',{},403);
    expect(await readFile(outside,'utf8')).toBe('{}'); await rm(outside);
  });
});
