import { mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApiApp } from '../../server/index.js';
import { appDataDir } from '../../server/app-state.js';
import { makeSlots, type PaperSnapshot } from '../../shared/papers.js';
import { listenLocal, request } from '../fixtures/api-server.js';
import { validPng } from '../fixtures/images.js';

const workspace = path.resolve('.tmp/papers-api');
const other = path.resolve('.tmp/papers-other');
let url: string;
beforeEach(async () => {
  await Promise.all([appDataDir, workspace, other].map(p => rm(p,{ recursive: true, force: true })));
  url = await listenLocal(createApiApp());
  await request(url).post('/api/workspaces/create-sample').send({ workspacePath: workspace }).expect(200);
});
async function op(action: string, data: Record<string, unknown> = {}, status = 200) {
  return request(url).post(`/api/papers/${action}`).send({ workspacePath: workspace,...data }).expect(status);
}
const ref = (s: PaperSnapshot) => ({ id: s.paper.id, revision: s.revision });
async function practice() {
  const { body } = await op('create',{ kind: 'practice' });
  body.paper.slots = makeSlots('practice',[0,0,1]);
  return (await op('save',{ ...ref(body), paper: body.paper })).body as PaperSnapshot;
}
async function generate(s: PaperSnapshot, extra: Record<string, unknown> = {}, status = 200) {
  const bank = await request(url).get('/api/bank').expect(200);
  return op('generate',{ ...ref(s), bankRevision: bank.body.revision,...extra },status);
}
describe('independent papers API', () => {
  it('creates, lists, conditionally saves, copies and deletes without touching bank', async () => {
    const original = await readFile(path.join(workspace,'bank.json'),'utf8');
    const s = (await op('create',{ kind: 'mock' })).body as PaperSnapshot;
    const draft = { ...s.paper, title: '期中模拟' };
    const saved = (await op('save',{ ...ref(s), paper: draft })).body;
    expect(saved.paper.title).toBe('期中模拟');
    expect(JSON.parse(await readFile(path.join(workspace,'papers',`${s.paper.id}.json.bak`),'utf8')).title).toBe(s.paper.title);
    await op('save',{ ...ref(s), paper: draft },409);
    const copy = (await op('copy',{ ...ref(saved),practice: true })).body;
    expect(copy.paper.kind).toBe('practice'); expect(copy.paper.slots.every((s: { subject: unknown }) => s.subject === null)).toBe(true);
    expect((await op('list')).body.papers).toHaveLength(2);
    await op('delete',ref(copy)); expect((await op('list')).body.papers).toHaveLength(1);
    expect(await readFile(path.join(workspace,'bank.json'),'utf8')).toBe(original);
    await op('read',{ id: '../../bank' },400);
    await op('create',{ kind: 'year-2025' },400);
    await op('list',{ workspacePath: other },409);
    await op('save',{ ...ref(saved), paper: { ...saved.paper, id: 'different' } },400);
  });
  it('saves settings with revision checks and leaves corrupt papers isolated', async () => {
    const settings = (await op('settings')).body;
    settings.settings.chapters['chapter-calculus'] = 'calculus';
    const saved = (await op('save-settings',settings)).body;
    await op('save-settings',settings,409);
    expect((await op('create',{ kind: 'mock' })).body.paper.rules).toEqual(saved.settings);
    await writeFile(path.join(workspace,'papers','broken.json'),'{broken');
    expect((await op('list')).body.warnings).toHaveLength(1);
    await request(url).get('/api/bank').expect(200);
    await op('save-settings',{ settings: { version: 1, chapters: {}, types: { bad: 'script' } },revision: saved.revision },400);
  });
  it('checks source revision and keeps snapshots after source edits/deletion', async () => {
    const s = await practice();
    await op('generate',{ ...ref(s), bankRevision: '0'.repeat(64) },409);
    const next = (await generate(s)).body as PaperSnapshot;
    expect(next.paper.slots[0].snapshot?.id).toBe('sample-limit');
    const bank = (await request(url).get('/api/bank')).body;
    bank.bank.items = [];
    await request(url).put('/api/bank').send({ workspacePath: workspace, baseRevision: bank.revision, bank: bank.bank }).expect(200);
    expect((await op('read',{ id: next.paper.id })).body.paper).toEqual(next.paper);
    const forged = structuredClone(next.paper); forged.slots[0].snapshot!.modules.question.tex = '改写';
    await op('save',{ ...ref(next),paper: forged },400);
    await generate(next,{ index: 0 },400);
    await op('export',ref(s),409);
  });
  it('copies validated attachment bytes and exports from independent snapshots', async () => {
    const bank = (await request(url).get('/api/bank')).body;
    await writeFile(path.join(workspace,'assets','sample.png'),validPng);
    bank.bank.items[0].assets = [{ id: 'img', fileName: 'sample.png', originalName: 'sample.png', relativePath: 'assets/sample.png', mimeType: 'image/png', size: validPng.length, uploadedAt: '2026-10-31' }];
    bank.bank.items[0].modules.question.tex += '\n\\qimg[s]{assets/sample.png}';
    await request(url).put('/api/bank').send({ workspacePath: workspace,baseRevision: bank.revision,bank: bank.bank }).expect(200);
    const next = (await generate(await practice())).body as PaperSnapshot;
    const asset = next.paper.slots[0].snapshot!.assets[0];
    expect(asset.fileName).toMatch(/^asset-/); expect(asset.sha256).toHaveLength(64);
    expect(await readFile(path.join(workspace,'papers',asset.fileName))).toEqual(validPng);
    await rm(path.join(workspace,'assets','sample.png'));
    await request(url).get(`/api/papers/assets/${asset.fileName}`).expect(200);
    // Save-as copies settings, independent snapshots, attachments and backups.
    const latest = (await request(url).get('/api/bank')).body.bank;
    latest.items = [];
    await request(url).post('/api/workspaces/save-as').send({ sourceWorkspacePath: workspace,targetWorkspacePath: other,bank: latest }).expect(200);
    expect(await readFile(path.join(other,'papers',asset.fileName))).toEqual(validPng);
    expect(JSON.parse(await readFile(path.join(other,'papers',`${next.paper.id}.json`),'utf8')).slots).toEqual(next.paper.slots);
  });
  it('rejects missing/invalid attachments without committing a partial paper', async () => {
    const bank = (await request(url).get('/api/bank')).body;
    bank.bank.items[0].assets = [{ id: 'missing', fileName: 'missing.png', originalName: 'missing.png', relativePath: 'assets/missing.png', mimeType: 'image/png', size: 3, uploadedAt: '2026-10-31' }];
    await request(url).put('/api/bank').send({ workspacePath: workspace,baseRevision: bank.revision,bank: bank.bank }).expect(200);
    const s = await practice();
    await generate(s,{},500);
    expect((await op('read',{ id: s.paper.id })).body).toEqual(s);
    await writeFile(path.join(workspace,'assets','missing.png'),'bad');
    await generate(s,{},400);
    expect((await op('read',{ id: s.paper.id })).body).toEqual(s);
    await op('export',ref(s),400);
  });
  it('fails closed on paper directories, JSON, backup and attachment symbolic links', async () => {
    await mkdir(other,{ recursive: true });
    await symlink(other,path.join(workspace,'papers'),'dir');
    await op('create',{ kind: 'mock' },403);
    await rm(path.join(workspace,'papers'));
    const s = (await op('create',{ kind: 'mock' })).body;
    const outside = path.join(other,'outside.json'); await writeFile(outside,'{}');
    await symlink(outside,path.join(workspace,'papers',`${s.paper.id}.json.bak`));
    await op('save',{ ...ref(s),paper: s.paper },403);
    await rm(path.join(workspace,'papers',`${s.paper.id}.json`));
    await symlink(outside,path.join(workspace,'papers',`${s.paper.id}.json`));
    await op('read',{ id: s.paper.id },403);
    expect(await readFile(outside,'utf8')).toBe('{}');
    const link = 'asset-00000000-0000-0000-0000-000000000000.png';
    await symlink(outside,path.join(workspace,'papers',link));
    await request(url).get(`/api/papers/assets/${link}`).expect(403);
    await request(url).get('/api/papers/assets/settings.json').expect(400);
    expect(await readdir(other)).toEqual(['outside.json']);
  });
  it('serializes competing saves, validates slot metadata and excludes pending questions', async () => {
    const s = await practice();
    const responses = await Promise.all(['A','B'].map(title => request(url).post('/api/papers/save').send({ workspacePath: workspace,...ref(s), paper: { ...s.paper,title } })));
    expect(responses.map(r => r.status).sort()).toEqual([200,409]);
    const current = (await op('read',{ id: s.paper.id })).body;
    await op('save',{ ...ref(current), paper: { ...current.paper, slots: [{ ...current.paper.slots[0], points: -1 }] } },400);
    const bank = (await request(url).get('/api/bank')).body;
    bank.bank.items.forEach((q: { reviewStatus: string }) => { q.reviewStatus = 'pending'; });
    await request(url).put('/api/bank').send({ workspacePath: workspace,baseRevision: bank.revision,bank: bank.bank }).expect(200);
    expect((await generate(current)).body.paper.slots[0].snapshot).toBeNull();
  });
});
