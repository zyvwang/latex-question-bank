import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {mkdir,readFile,readdir,rm,writeFile,symlink} from 'node:fs/promises';
import path from 'node:path';
import {createApiApp} from '../../server/index.js';
import {getAgentToken} from '../../server/agent-auth.js';
import {appDataDir} from '../../server/app-state.js';
import {createSampleBank} from '../../server/bank-schema.js';
import {listenLocal,request} from '../fixtures/api-server.js';
import * as jsonFile from '../../server/json-file.js';
import {type FamilyView} from '../../shared/variants.js';
import {type BankSnapshot} from '../../shared/types.js';
import {type VariantImportResult} from '../../shared/variant-import.js';
import {type ImportIntent} from '../../server/variant-import-storage.js';
const workspacePath=path.resolve('.tmp/variant-import-api');let url:string;
const op=(action:string,body:Record<string,unknown>={},status=200,agent=false) => {
  const req=request(url).post(`/api/${agent?'agent/':''}variants/${action}`);
  if (agent) req.set('Authorization',`Bearer ${getAgentToken()}`);
  return req.send({workspacePath,...body}).expect(res => {if (res.status !== status) throw new Error(JSON.stringify(res.body));}).expect(status);
};
const bank=async ():Promise<BankSnapshot> => (await request(url).get('/api/bank').expect(200)).body;
async function enable(allowed=true) {
  let o=(await op('list')).body;await op('set-enabled',{enabled:true,configRevision:o.configRevision});
  o=(await op('list')).body;if (allowed) await op('set-agent-auto-enroll',{allowed:true,configRevision:o.configRevision});
}
const content={targetKind:'B',question:'求 $1+1=$\\blank。',answer:'2',solution:'由加法得 2。'};
function newGroup() {return {operationId:crypto.randomUUID(),original:{kind:'new',manifest:{schemaVersion:1,questions:[{id:crypto.randomUUID() as string,solutionSource:'agent',questionTypes:['解答'],modules:{question:{tex:'求 $1+1$。'},solution:{tex:'等于 2。'}}}]}},variants:[{id:crypto.randomUUID(),content}],refusals:[]};}
async function existingGroup(id?:string) {
  const b=await bank();const read=(await op('read-original',{rootId:id ?? b.bank.items[0].id},200,true)).body;
  return {operationId:crypto.randomUUID(),original:{kind:'existing',id:read.root.id,fingerprint:read.fingerprint,familyId:read.familyId,revision:read.revision},variants:[{id:crypto.randomUUID(),content}],refusals:[]};
}
async function imported(group:unknown,dryRun=false) {return (await op('import',{group,dryRun},200,true)).body as VariantImportResult;}
beforeEach(async () => {
  await Promise.all([workspacePath,appDataDir].map(p => rm(p,{recursive:true,force:true})));await mkdir(workspacePath,{recursive:true});
  const b=createSampleBank();b.items=[b.items[0]];b.items[0].questionTypes=['解答'];await writeFile(path.join(workspacePath,'bank.json'),JSON.stringify(b));
  url=await listenLocal(createApiApp());await request(url).post('/api/workspaces/open').send({workspacePath}).expect(200);
});
afterEach(() => vi.restoreAllMocks());
describe('Agent joint original and variant import',() => {
  it('defaults authorization off, forbids Agent permission changes and validates before writing',async () => {
    const g=newGroup();await op('import',{group:g},403,true);await enable(false);await op('import',{group:g},403,true);
    await op('set-agent-auto-enroll',{allowed:true},403,true);
    await enable();const before=await readdir(path.join(workspacePath,'variants'));const b=await bank();
    expect((await imported(g,true)).status).toBe('dry-run');expect(await readdir(path.join(workspacePath,'variants'))).toEqual(before);expect((await bank()).revision).toBe(b.revision);expect(await readdir(workspacePath)).not.toContain('.history');
  });
  it('imports new pending original and multiple versions, repeats idempotently and preserves histories on undo',async () => {
    await enable();const g=newGroup();g.variants.push({id:crypto.randomUUID(),content:{...content,targetKind:'C',question:'计算 $1+1$。'}});
    const result=await imported(g);expect(result.pendingCount).toBe(3);let b=await bank();const original=b.bank.items.find(q => q.id===result.rootId)!;expect(original.reviewStatus).toBe('pending');
    const v=(await op('read',{familyId:result.familyId})).body as FamilyView;expect(v.rows).toHaveLength(2);expect(v.rows.every(r => !r.eligible && r.entry.status==='pending')).toBe(true);
    expect(await imported(g)).toEqual(result);expect((await bank()).revision).toBe(b.revision);
    expect((await op('import',{group:{...g,refusals:[{targetKind:'A',reason:'条件不适合'}]}},409,true)).body.code).toBe('VARIANT_OPERATION_REUSED');
    expect((await op('import-result',{operationId:g.operationId},200,true)).body.result).toEqual(result);
    await request(url).post('/api/agent/undo').set('Authorization',`Bearer ${getAgentToken()}`).send({workspacePath,batchId:result.batchId,baseRevision:b.revision}).expect(200);
    b=await bank();expect(b.bank.items.some(q => q.id===result.rootId)).toBe(false);expect((await op('read',{familyId:result.familyId})).body.rows.every((r:{state:string}) => r.state==='原题缺失')).toBe(true);
  });
  it('enrolls an explicitly read original without modifying it and appends to its existing family',async () => {
    await enable();const before=await bank();const result=await imported(await existingGroup());expect((await bank()).revision).toBe(before.revision);expect(result.pendingCount).toBe(1);
    const second=await imported(await existingGroup());expect(second.familyId).toBe(result.familyId);expect((await op('read',{familyId:result.familyId})).body.rows).toHaveLength(2);
    const group=await existingGroup();group.variants=[];Object.assign(group,{refusals:[{targetKind:'A',reason:'四个不同选项无法保留全部子问'}]});
    expect((await imported(group)).pendingCount).toBe(0);expect((await op('read',{familyId:result.familyId})).body.family.refusals).toHaveLength(1);
  });
  it('permits a new original with zero versions and a documented refusal',async () => {
    await enable();const g=newGroup();g.variants=[];Object.assign(g,{refusals:[{targetKind:'A',reason:'保留全部子问需要解答表达'}]});const result=await imported(g);expect(result.pendingCount).toBe(1);const view=(await op('read',{familyId:result.familyId})).body as FamilyView;expect(view.rows).toHaveLength(0);expect(view.family.refusals).toHaveLength(1);
  });
  it('rejects stale original or associations and protected-type edits',async () => {
    await enable();const stale=await existingGroup();const b=await bank();b.bank.items[0].modules.note.tex='新备注';await request(url).put('/api/bank').send({workspacePath,bank:b.bank,baseRevision:b.revision}).expect(200);
    await op('import',{group:stale},409,true);
    const fresh=await existingGroup();await imported(fresh);await op('import',{group:{...fresh,operationId:crypto.randomUUID()}},409,true);
    const next=await bank();next.bank.items[0].questionTypes=['证明'];await request(url).put('/api/bank').send({workspacePath,bank:next.bank,baseRevision:next.revision}).expect(409);
  });
  it('rejects ambiguous types, forbidden conversion, incomplete content and source/id collisions with no partial group',async () => {
    await enable();const before=await bank();const g=newGroup();g.original.manifest.questions[0].questionTypes=['解答','填空'];await op('import',{group:g},400,true);
    g.original.manifest.questions[0].questionTypes=['证明'];await op('import',{group:g},400,true);
    g.original.manifest.questions[0].questionTypes=['解答'];g.variants.push({id:crypto.randomUUID(),content:{...content,answer:''}});await op('import',{group:g},400,true);expect((await bank()).revision).toBe(before.revision);
    const conflict=newGroup();conflict.original.manifest.questions[0].id=before.bank.items[0].id;await op('import',{group:conflict},409,true);
    const sourceConflict=newGroup();Object.assign(sourceConflict.original.manifest.questions[0],{source:before.bank.items[0].source});await op('import',{group:sourceConflict},409,true);
    await imported(newGroup());expect((await bank()).bank.items).toHaveLength(2);
  });
  it('validates all attachment bytes and paths before any save; creates independent copies',async () => {
    await enable();const g=newGroup();const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6dXcAAAAASUVORK5CYII=','base64');
    const sharp=(await import('sharp')).default;const png=await sharp({create:{width:4,height:4,channels:3,background:'white'}}).png().toBuffer();
    Object.assign(g.original.manifest,{assets:[{key:'figure',originalName:'figure.png'}]});Object.assign(g.original.manifest.questions[0],{assets:['figure']});
    g.original.manifest.questions[0].modules.question.tex+=' \\qimg{{{asset:figure}}}';
    g.variants[0].content={...content,question:'计算 \\blank。\\qimg{{{asset:figure}}}'};
    const payload={...g,uploads:[{key:'figure',mimeType:'image/png',base64:image.toString('base64')}]};
    await op('import',{group:payload},400,true);expect((await bank()).bank.items).toHaveLength(1);
    payload.uploads[0].base64=png.toString('base64');const before=await readdir(path.join(workspacePath,'variants'));await imported(payload,true);expect(await readdir(path.join(workspacePath,'variants'))).toEqual(before);
    await rm(path.join(workspacePath,'assets'),{recursive:true});await symlink(path.resolve('.tmp'),path.join(workspacePath,'assets'));await op('import',{group:payload},403,true);await rm(path.join(workspacePath,'assets'));const result=await imported(payload);
    const view=(await op('read',{familyId:result.familyId})).body as FamilyView;expect(view.rows[0].revision.item.assets[0].fileName).not.toBe(view.root!.assets[0].fileName);expect(await readFile(path.join(workspacePath,'variants',view.rows[0].revision.item.assets[0].fileName))).toEqual(png);
  });
  it('recovers interrupted commits by hashes and reports their original result',async () => {
    await enable();const g=newGroup();const write=jsonFile.writeJsonFileAtomic;let interrupted=false;
    vi.spyOn(jsonFile,'writeJsonFileAtomic').mockImplementation(async (file,value,options) => {if (path.basename(file).startsWith('family-') && !interrupted) {interrupted=true;throw new Error('simulated process interruption');}return write(file,value,options);});
    await op('import',{group:g},500,true);expect(interrupted).toBe(true);
    const status=(await op('import-result',{operationId:g.operationId},200,true)).body;expect(status.status).toBe('completed');expect((await bank()).bank.items.filter(q => q.id===g.original.manifest.questions[0].id)).toHaveLength(1);expect(await imported(g)).toEqual(status.result);
    expect((await readdir(path.join(workspacePath,'variants'))).some(f => f.startsWith('import-tx-'))).toBe(false);
  });
  it('isolates unknown external changes, leaves files intact and allows unrelated groups',async () => {
    await enable();const g=newGroup();const write=jsonFile.writeJsonFileAtomic;let interrupted=false;
    vi.spyOn(jsonFile,'writeJsonFileAtomic').mockImplementation(async (file,value,options) => {if (path.basename(file).startsWith('family-') && !interrupted) {interrupted=true;throw new Error('interruption');}return write(file,value,options);});
    await op('import',{group:g},500,true);
    const bankPath=path.join(workspacePath,'bank.json');const external=JSON.parse(await readFile(bankPath,'utf8'));external.items[0].modules.note.tex='外部编辑';const raw=JSON.stringify(external);await writeFile(bankPath,raw);
    expect((await op('import-result',{operationId:g.operationId},200,true)).body.status).toBe('isolated');expect(await readFile(bankPath,'utf8')).toBe(raw);
    const tx=JSON.parse(await readFile(path.join(workspacePath,'variants',`import-tx-${g.operationId}.json`),'utf8')) as ImportIntent;expect(tx.isolated).toBe(true);await op('import',{group:g},409,true);
    await imported(newGroup());expect((await bank()).bank.items[0].modules.note.tex).toBe('外部编辑');
  });
});
