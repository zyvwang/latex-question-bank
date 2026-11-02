import {validPng} from '../fixtures/images.js';
import {createHash} from 'node:crypto';
import {mkdir,readFile,readdir,rm,symlink,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {beforeEach,describe,it,expect} from 'vitest';
import {createApiApp} from '../../server/index.js';
import {getAgentToken} from '../../server/agent-auth.js';
import {appDataDir} from '../../server/app-state.js';
import {createSampleBank} from '../../server/bank-schema.js';
import {listenLocal,request} from '../fixtures/api-server.js';
import {type FamilyView,type VariantOverview,type FamilySnapshot} from '../../shared/variants.js';
import {type BankSnapshot} from '../../shared/types.js';
import {type PaperSnapshot} from '../../shared/papers.js';
import {readFamily,writeVariantJson,recoverTypeCorrections} from '../../server/variant-storage.js';
import {revisionForContent,serializeJson} from '../../server/storage-utils.js';
const workspacePath=path.resolve('.tmp/variants-api');let url:string;
const op=(action:string,body:Record<string,unknown>={},status=200,agent=false) => {
  const req=request(url).post(`/api/${agent?'agent/':''}variants/${action}`);
  if (agent) req.set('Authorization',`Bearer ${getAgentToken()}`);
  return req.send({workspacePath,...body}).expect(status);
};
const bank=async ():Promise<BankSnapshot> => (await request(url).get('/api/bank').expect(200)).body;
const overview=async ():Promise<VariantOverview> => (await op('list')).body;
const read=async(id:string):Promise<FamilyView> => (await op('read',{familyId:id})).body;
async function enroll() {
  const o=await overview();await op('set-enabled',{enabled:true,configRevision:o.configRevision});const b=await bank();
  const f=(await op('create-family',{bankRevision:b.revision,rootId:b.bank.items[0].id,originalKind:'C'})).body as FamilySnapshot;return read(f.family.id);
}
const content={targetKind:'B',question:'求原式的值：\\blank',answer:'1',solution:'计算得 1。'};
async function propose(v:FamilyView,extra:Record<string,unknown>={},status=200) {
  return op('propose',{familyId:v.family.id,revision:v.revision,rootFingerprint:v.rootFingerprint,bankRevision:(await bank()).revision,variantId:crypto.randomUUID(),content,...extra},status,true);
}
async function approve(v:FamilyView,extra:Record<string,unknown>={},status=200) {
  return op('review',{familyId:v.family.id,revision:v.revision,rootFingerprint:v.rootFingerprint,bankRevision:(await bank()).revision,entries:v.rows.map(r => ({variantId:r.entry.id,versionRevision:r.revision.id,action:'approve',...extra}))},status);
}
async function editBank(change:(b:BankSnapshot['bank'])=>void,status=200) {const b=await bank();change(b.bank);return request(url).put('/api/bank').send({workspacePath,baseRevision:b.revision,bank:b.bank}).expect(status);}
beforeEach(async () => {
  await Promise.all([workspacePath,appDataDir].map(p => rm(p,{recursive:true,force:true})));await mkdir(workspacePath,{recursive:true});
  const b=createSampleBank();b.items=[b.items[0]];b.items[0].questionTypes=['解答'];await writeFile(path.join(workspacePath,'bank.json'),JSON.stringify(b));
  url=await listenLocal(createApiApp());await request(url).post('/api/workspaces/open').send({workspacePath}).expect(200);
});
describe('independent version management and protected original types',() => {
  it('defaults off, enforces Agent permissions and dry-run does not write',async () => {
    expect((await overview()).config.enabled).toBe(false);expect(await readdir(workspacePath)).not.toContain('variants');
    await request(url).post('/api/agent/variants/propose').send({workspacePath}).expect(401);
    for (const action of ['set-enabled','create-family','correct-type','review']) await op(action,{},403,true);
    await op('propose',{},409,true);
    const v=await enroll();const files=await readdir(path.join(workspacePath,'variants'));await propose(v,{dryRun:true});
    expect(await readdir(path.join(workspacePath,'variants'))).toEqual(files);expect((await read(v.family.id)).rows).toHaveLength(0);
    await propose(v);expect((await read(v.family.id)).rows[0].state).toBe('待审阅');
  });
  it('protects types while permitting normal math edits; review stamps expire only on semantic changes',async () => {
    let v=await enroll();await propose(v);v=await read(v.family.id);await approve(v);v=await read(v.family.id);expect(v.rows[0].eligible).toBe(true);
    expect((await editBank(b => {b.items[0].questionTypes=['选择'];},409)).body.code).toBe('ORIGINAL_TYPE_PROTECTED');
    await editBank(b => {b.items[0].topics=['新考点'];b.items[0].reviewPriority='must';b.items[0].modules.note.tex='备注';});
    expect((await read(v.family.id)).rows[0].eligible).toBe(true);
    await editBank(b => {b.items[0].modules.question.tex+=' 新条件';});
    v=await read(v.family.id);expect(v.rows[0].state).toBe('待复核');await approve(v,{},400);await approve(v,{confirmCurrentBasis:true});
    expect((await read(v.family.id)).rows[0].entry.reviews).toHaveLength(2);
    await editBank(b => {b.items[0].reviewStatus='pending';});expect((await read(v.family.id)).rows[0].state).toBe('原题待审阅');
  });
  it('queues only versions awaiting a decision, in bank order, and hides from Agents and disabled workspaces',async () => {
    expect((await op('queue')).body).toMatchObject({enabled:false,families:[],total:0});
    await op('queue',{},403,true);
    let v=await enroll();await propose(v);
    let queue=(await op('queue')).body;
    expect(queue).toMatchObject({enabled:true,total:1});
    expect(queue.families[0].family.id).toBe(v.family.id);
    expect(queue.families[0].rows[0].history).toEqual([]);
    v=await read(v.family.id);await approve(v);
    expect((await op('queue')).body.total).toBe(0);
    await editBank(b => {b.items[0].modules.question.tex+=' 改动';});
    queue=(await op('queue')).body;
    expect(queue.total).toBe(1);
    expect(queue.families[0].rows[0].state).toBe('待复核');
    v=await read(v.family.id);await approve(v,{},400);await approve(v,{confirmCurrentBasis:true});
    expect((await op('queue')).body.total).toBe(0);
  });
  it('creates pending immutable revisions, rejects stale revisions and keeps refusal records',async () => {
    let v=await enroll();await propose(v);v=await read(v.family.id);await approve(v);v=await read(v.family.id);
    const row=v.rows[0];const raw=await readFile(path.join(workspacePath,'variants',`revision-${row.revision.id}.json`),'utf8');
    const body={familyId:v.family.id,revision:v.revision,bankRevision:(await bank()).revision,rootFingerprint:v.rootFingerprint,variantId:row.entry.id,versionRevision:row.revision.id,content:{...content,answer:'2'}};
    await op('revise',body,200,true);await op('revise',body,409,true);v=await read(v.family.id);
    expect(v.rows[0].state).toBe('待审阅');expect(v.rows[0].history).toHaveLength(2);expect(await readFile(path.join(workspacePath,'variants',`revision-${row.revision.id}.json`),'utf8')).toBe(raw);
    await op('refuse',{familyId:v.family.id,revision:v.revision,bankRevision:(await bank()).revision,rootFingerprint:v.rootFingerprint,targetKind:'A',reason:'多个求解目标不适合选择表达'},200,true);
    expect((await read(v.family.id)).family.refusals).toHaveLength(1);
  });
  it('corrects original type with audit and epoch invalidation, then forbids ABC to D approvals',async () => {
    let v=await enroll();await propose(v);v=await read(v.family.id);await approve(v);v=await read(v.family.id);
    await op('correct-type',{familyId:v.family.id,revision:v.revision,bankRevision:(await bank()).revision,originalKind:'D',reason:'原题实际要求证明'});
    v=await read(v.family.id);expect(v.family.typeEpoch).toBe(2);expect(v.family.corrections).toHaveLength(1);expect((await bank()).bank.items[0].questionTypes).toEqual(['证明']);expect(v.rows[0].state).toBe('题型不允许');await approve(v,{confirmCurrentBasis:true},400);
    expect((await readdir(path.join(workspacePath,'variants'))).some(f => /^type-tx-.*\.json$/.test(f))).toBe(false);
  });
  it('keeps old versions when original is deleted and restores only a matching protected type',async () => {
    let v=await enroll();await propose(v);v=await read(v.family.id);await approve(v);const original=(await bank()).bank.items[0];
    await editBank(b => {b.items=b.items.filter(q => q.id !== original.id);});v=await read(v.family.id);expect(v.rows[0].state).toBe('原题缺失');expect(v.family.baseline?.modules.question.tex).toBe(original.modules.question.tex);
    await editBank(b => {b.items.push({...original,questionTypes:['选择']});},409);
    await editBank(b => {b.items.push(original);});expect((await read(v.family.id)).rows[0].eligible).toBe(true);
  });
  it('opts in per paper and prevents original-family duplicates across types; old snapshots survive disable and source deletion',async () => {
    let v=await enroll();await propose(v);v=await read(v.family.id);await approve(v);
    const paperOp=(action:string,body:Record<string,unknown>) => request(url).post(`/api/papers/${action}`).send({workspacePath,...body}).expect(200);
    let p=(await paperOp('create',{kind:'practice',counts:[0,1,1]})).body as PaperSnapshot;
    p=(await paperOp('generate',{id:p.paper.id,revision:p.revision,bankRevision:(await bank()).revision})).body;expect(p.paper.slots[0].snapshot).toBeNull();
    p.paper.useVariants=true;p=(await paperOp('save',{id:p.paper.id,revision:p.revision,paper:p.paper})).body;
    p=(await paperOp('generate',{id:p.paper.id,revision:p.revision,bankRevision:(await bank()).revision})).body;
    expect(p.paper.slots.filter(s => s.snapshot)).toHaveLength(1);
    p=(await paperOp('create',{kind:'practice',counts:[0,1,0],useVariants:true})).body;
    // Explicit manual version is a supported reference, stored with immutable provenance.
    p=(await paperOp('generate',{id:p.paper.id,revision:p.revision,index:0,manualRef:{kind:'variant',id:v.rows[0].entry.id,revision:v.rows[0].revision.id},bankRevision:(await bank()).revision})).body;
    expect(p.paper.slots[0].origin?.rootId).toBe(v.family.rootId);
    const saved=p.paper.slots[0];await editBank(b => {b.items=[];});const o=await overview();await op('set-enabled',{configRevision:o.configRevision,enabled:false});
    expect((await paperOp('read',{id:p.paper.id})).body.paper.slots[0]).toEqual(saved);
  });
  it('copies image bytes independently, detects tampering and preserves them on workspace save-as',async () => {
    await mkdir(path.join(workspacePath,'assets'),{recursive:true});await writeFile(path.join(workspacePath,'assets','root.png'),validPng);
    await editBank(b => {const root=b.items[0];root.assets=[{id:'figure',fileName:'root.png',relativePath:'assets/root.png',originalName:'root.png',mimeType:'image/png',size:validPng.length,uploadedAt:'now',sha256:createHash('sha256').update(validPng).digest('hex')}];root.modules.question.tex+=' \\includegraphics{assets/root.png}';});
    let v=await enroll();await propose(v,{content:{...content,question:'图中结果为 \\blank。\\includegraphics{assets/root.png}'}});v=await read(v.family.id);await approve(v);v=await read(v.family.id);
    const asset=v.rows[0].revision.item.assets[0];expect(asset.fileName).not.toBe('root.png');expect(await readFile(path.join(workspacePath,'variants',asset.fileName))).toEqual(validPng);
    const target=path.resolve('.tmp/variants-save-as');await rm(target,{recursive:true,force:true});
    await request(url).post('/api/workspaces/save-as').send({sourceWorkspacePath:workspacePath,targetWorkspacePath:target,bank:(await bank()).bank}).expect(200);
    expect(await readFile(path.join(target,'variants',asset.fileName))).toEqual(validPng);expect((await readFamily(target,v.family.id)).family.versions).toEqual(v.family.versions);
    await request(url).post('/api/workspaces/open').send({workspacePath}).expect(200);
    await writeFile(path.join(workspacePath,'variants',asset.fileName),Buffer.from('tampered'));v=await read(v.family.id);expect(v.rows[0].state).toBe('附件需核对');await approve(v,{},400);
    await writeFile(path.join(workspacePath,'variants',asset.fileName),validPng);await rm(path.join(workspacePath,'assets','root.png'));expect((await read(v.family.id)).rows[0].eligible).toBe(false);expect(await readFile(path.join(target,'variants',asset.fileName))).toEqual(validPng);
  });
  it('rejects protected Agent type edits and import overwrite in previews and commits',async () => {
    const v=await enroll();const b=await bank();const token=`Bearer ${getAgentToken()}`;
    for (const dryRun of [true,false]) {
      await request(url).post('/api/agent/tags').set('Authorization',token).send({workspacePath,baseRevision:b.revision,dryRun,manifest:{schemaVersion:1,field:'questionTypes',changes:[{id:v.family.rootId,remove:['解答'],add:['选择']}]}}).expect(409);
      const original=b.bank.items[0];const title=b.bank.books.find(book => book.id === original.source?.bookId)!.title;
      const manifest={schemaVersion:1,books:[{title}],questions:[{source:{bookTitle:title,label:original.source!.label},questionTypes:['选择'],modules:{question:original.modules.question,solution:original.modules.solution},solutionSource:'agent',assets:[]}]};
      await request(url).post('/api/agent/import').set('Authorization',token).field('workspacePath',workspacePath).field('manifest',JSON.stringify(manifest)).field('overwrite','true').field('dryRun',String(dryRun)).field('baseRevision',b.revision).expect(409);
    }
    expect((await bank()).revision).toBe(b.revision);
  });
  it('blocks type undo and import-batch undo that would restore a different protected original type',async () => {
    const token=`Bearer ${getAgentToken()}`;await editBank(b => {b.items[0].questionTypes=['选择'];});let b=await bank();
    const tagged=(await request(url).post('/api/agent/tags').set('Authorization',token).send({workspacePath,baseRevision:b.revision,manifest:{schemaVersion:1,field:'questionTypes',changes:[{id:b.bank.items[0].id,remove:['选择'],add:['解答']}]}}).expect(200)).body;
    await enroll();await request(url).post('/api/agent/tags/undo').set('Authorization',token).send({workspacePath,baseRevision:tagged.revision,journal:tagged.journal}).expect(409);
    // A separate root is imported before enrollment, so its batch's restore point has a different type.
    await editBank(bank => {const item={...structuredClone(bank.items[0]),id:'before-import',source:{bookId:bank.items[0].source!.bookId,label:'待覆盖原题'},questionTypes:[],chapterOrder:2};bank.items.push(item);});b=await bank();const title=b.bank.books[0].title;
    const manifest={schemaVersion:1,books:[{title}],questions:[{source:{bookTitle:title,label:'待覆盖原题'},questionTypes:['解答'],modules:{question:{tex:'计算'},solution:{tex:'结果'}},solutionSource:'agent',assets:[]}]};
    const imported=(await request(url).post('/api/agent/import').set('Authorization',token).field('workspacePath',workspacePath).field('manifest',JSON.stringify(manifest)).field('overwrite','true').field('baseRevision',b.revision).expect(200)).body;
    await op('create-family',{rootId:'before-import',originalKind:'C',bankRevision:(await bank()).revision});
    await request(url).post('/api/agent/undo').set('Authorization',token).send({workspacePath,batchId:imported.batchId,baseRevision:(await bank()).revision}).expect(409);
    expect((await bank()).bank.items.find(q => q.id==='before-import')?.questionTypes).toEqual(['解答']);
  });
  it('detects edited immutable revision files without affecting the original bank',async () => {
    let v=await enroll();await propose(v);v=await read(v.family.id);await approve(v);v=await read(v.family.id);
    const file=path.join(workspacePath,'variants',`revision-${v.rows[0].revision.id}.json`);const doc=JSON.parse(await readFile(file,'utf8'));doc.content.answer='外部改写';await writeFile(file,JSON.stringify(doc));
    expect((await op('read',{familyId:v.family.id},409)).body.code).toBe('VARIANT_REVISION_CHANGED');await bank();
  });
  it('recovers a bank-first correction and isolates unknown external state without replacing it',async () => {
    const v=await enroll();const before=await bank();const familyAfter={...v.family,originalKind:'B' as const,typeEpoch:2};const after=structuredClone(before.bank);after.items[0].questionTypes=['填空'];const raw=serializeJson(after);
    const file=`type-tx-${v.family.id}.json`;const intent={version:1,familyId:v.family.id,bankBefore:before.revision,bankAfter:revisionForContent(raw),familyBefore:v.revision,familyAfter};
    await writeVariantJson(workspacePath,file,intent);await writeFile(path.join(workspacePath,'bank.json'),raw);await recoverTypeCorrections(workspacePath);expect((await readFamily(workspacePath,v.family.id)).family.originalKind).toBe('B');
    await writeVariantJson(workspacePath,file,intent);after.items[0].modules.question.tex+='外部编辑';const external=serializeJson(after);await writeFile(path.join(workspacePath,'bank.json'),external);await recoverTypeCorrections(workspacePath);
    expect(await readFile(path.join(workspacePath,'bank.json'),'utf8')).toBe(external);expect((await read(v.family.id)).blocked).toBe(true);await bank();
  });
  it('rejects symlink storage and corrupt family metadata without blocking bank reads',async () => {
    const v=await enroll();const dir=path.join(workspacePath,'variants');await writeFile(path.join(dir,`family-${v.family.id}.json`),'broken');
    expect((await overview()).warnings).toHaveLength(1);await editBank(b => {b.items[0].questionTypes=['选择'];},409);await bank();
    await rm(dir,{recursive:true});await symlink(path.resolve('.tmp'),dir);await op('list',{},403);await bank();
  });
});
