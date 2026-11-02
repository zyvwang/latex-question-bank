import { describe, expect, it } from 'vitest';
import { blueprintId, blueprintYears, historicalTopics, legacyBlueprintId, parseTopicStore, quotaRequirements, seedHash, topicFingerprintSource, topicGroup, topicGroups } from '../../shared/paper-topics.js';
import { configureQuota, defaultPaperSettings, fillPaper, makeSlots, parsePaper, slotProblems, type Paper } from '../../shared/papers.js';
import { createSampleBank } from '../../server/bank-schema.js';
import { questionFingerprint } from '../../server/paper-topic-service.js';

const fixture = (): Paper => ({ version: 3, useVariants: false,quota:{ enabled:true,blueprintId },id:'quota',kind:'mock',seed:'seed',title:'综合模拟',filters:{ priorities:[],chapters:[],topics:[],books:[] },rules:defaultPaperSettings(),latex:createSampleBank().settings,slots:makeSlots('mock'),createdAt:'now',updatedAt:'now' });
describe('auditable topic quotas', () => {
  it('contains 132 annotations with the correct section subjects and quota totals', () => {
    expect(Object.values(historicalTopics).flat()).toHaveLength(132);
    const slots = makeSlots('mock');
    for (const row of Object.values(historicalTopics)) row.forEach((id,i) => expect(topicGroup(id)?.subject).toBe(slots[i].subject));
    for (let n = 0; n < 100; n++) {
      const required = quotaRequirements(String(n)); expect(required).toHaveLength(22);
      expect(quotaRequirements(String(n))).toEqual(required);
      required.forEach((id,i) => expect(topicGroup(id)?.subject).toBe(slots[i].subject));
      const bins = new Set(slots.map(s => `${s.section}:${s.subject}`));
      for (const bin of bins) {
        const indices = slots.flatMap((s,i) => `${s.section}:${s.subject}` === bin ? [i] : []);
        for (const group of topicGroups) {
          const total = Object.values(historicalTopics).flatMap(row => indices.map(i => row[i])).filter(id => id === group.id).length;
          const allocated = indices.filter(i => required[i] === group.id).length;
          expect(allocated).toBeGreaterThanOrEqual(Math.floor(total/6));
          expect(allocated).toBeLessThanOrEqual(Math.ceil(total/6));
        }
      }
    }
  });
  it('recovers each six-year frequency over the six systematic offsets', () => {
    const slots = makeSlots('mock');
    for (const bin of new Set(slots.map(s => `${s.section}:${s.subject}`))) {
      const indices = slots.flatMap((s,i) => `${s.section}:${s.subject}` === bin ? [i] : []);
      const seeds = new Map<number,string>();
      for (let n = 0; seeds.size < 6; n++) seeds.set(seedHash(`${n}:${bin}`)%6,String(n));
      for (const group of topicGroups) {
        const total = Object.values(historicalTopics).flatMap(row => indices.map(i => row[i])).filter(id => id === group.id).length;
        expect([...seeds.values()].flatMap(seed => indices.map(i => quotaRequirements(seed)[i])).filter(id => id === group.id)).toHaveLength(total);
      }
    }
  });
  it('keeps saved papers on the five-year blueprint they were built with', () => {
    expect(blueprintYears[legacyBlueprintId]).toHaveLength(5);
    const slots = makeSlots('mock');
    for (const bin of new Set(slots.map(s => `${s.section}:${s.subject}`))) {
      const indices = slots.flatMap((s,i) => `${s.section}:${s.subject}` === bin ? [i] : []);
      const required = quotaRequirements('legacy',legacyBlueprintId);
      for (const group of topicGroups) {
        const total = blueprintYears[legacyBlueprintId].flatMap(year => indices.map(i => historicalTopics[year][i])).filter(id => id === group.id).length;
        const allocated = indices.filter(i => required[i] === group.id).length;
        expect(allocated).toBeGreaterThanOrEqual(Math.floor(total/5));
        expect(allocated).toBeLessThanOrEqual(Math.ceil(total/5));
      }
    }
    const saved = { ...fixture(),quota:{ enabled:true,blueprintId:legacyBlueprintId },slots:slots.map((s,i) => ({ ...s,requiredGroup:quotaRequirements('seed',legacyBlueprintId)[i] })) };
    expect(parsePaper(saved).quota.blueprintId).toBe(legacyBlueprintId);
    expect(() => parsePaper({ ...saved,quota:{ enabled:true,blueprintId:'unknown' } })).toThrow();
  });
  it('reserves explicitly requested IDs before automatic positions in a mixed batch', () => {
    const bank = createSampleBank(); bank.items = ['a','b','c'].map(id => ({...structuredClone(bank.items[0]),id}));
    const paper = { ...fixture(),kind:'practice' as const,quota:{ enabled:false,blueprintId },slots:makeSlots('practice',[0,0,2]) };
    const first = fillPaper(bank,paper,[0,1]).slots[0].snapshot!.id;
    const result = fillPaper(bank,paper,[0,1],undefined,{}, {1:first});
    expect(result.slots[1].snapshot!.id).toBe(first);
    expect(result.slots[0].snapshot!.id).not.toBe(first);
  });
  it('keeps source fingerprints through paper asset renaming but invalidates semantic changes', () => {
    const item = createSampleBank().items[0];
    item.assets = [{ id:'img',fileName:'old.png',originalName:'old.png',relativePath:'assets/old.png',mimeType:'image/png',size:10,uploadedAt:'now' }];
    item.modules.question.tex += '\\qimg[m]{assets/old.png}';
    const copy = structuredClone(item); copy.assets[0].fileName = 'asset-copy.png'; copy.assets[0].relativePath = 'assets/asset-copy.png'; copy.assets[0].sha256 = 'abc'; copy.modules.question.tex = copy.modules.question.tex.replaceAll('assets/old.png','assets/asset-copy.png');
    expect(questionFingerprint(copy)).toBe(questionFingerprint(item));
    copy.modules.solution.tex = 'new solution'; copy.reviewPriority = 'must'; expect(topicFingerprintSource(copy)).toBe(topicFingerprintSource(item));
    copy.topics = ['新考点']; expect(questionFingerprint(copy)).not.toBe(questionFingerprint(item));
  });
  it('does not let candidates or locks relax a quota and migrates v1 only in memory', () => {
    const paper = configureQuota(fixture()); const bank = createSampleBank();
    expect(fillPaper(bank,paper).slots.map(s => s.requiredGroup)).toEqual(paper.slots.map(s => s.requiredGroup));
    expect(slotProblems(fillPaper(bank,paper)).filter(Boolean)).toHaveLength(22);
    const v1 = { ...paper,version:1,quota:undefined,slots:makeSlots('mock') };
    expect(parsePaper(v1).version).toBe(3); expect(parsePaper(v1).quota.enabled).toBe(false); expect(v1.version).toBe(1);
    const invalid = structuredClone(paper); invalid.slots[0].requiredGroup = 'L01'; expect(() => parsePaper(invalid)).toThrow('配额');
    expect(() => parseTopicStore({ version:1,items:{ x:{ approved:{groupId:'missing',fingerprint:'a'.repeat(64)},proposal:null } } })).toThrow();
  });
});
