import { describe, expect, it } from 'vitest';
import { candidates, classify, defaultPaperSettings, fillPaper, makeSlots, matchesSlot, parsePaper, parsePaperSettings, slotProblems, type Paper } from '../../shared/papers.js';
import { createSampleBank } from '../../server/bank-schema.js';
import { buildPaperLatex } from '../../server/paper-export.js';

export function fixture(): Paper {
  return { version: 3, useVariants: false, quota: { enabled: false, blueprintId: 'math1-2021-2025-v1' }, id: 'test-paper', kind: 'mock', title: '数一模拟卷', seed: '42', filters: { priorities: [], chapters: [], topics: [], books: [] }, rules: { ...defaultPaperSettings(), chapters: { 'chapter-calculus': 'calculus', 'chapter-linear-algebra': 'linear' } }, latex: createSampleBank().settings, slots: makeSlots('mock'), createdAt: '2026-10-31', updatedAt: '2026-10-31' };
}
describe('paper planning', () => {
  it('fixes 22 slots, 150 points and the subject totals', () => {
    const p = fixture();
    expect(p.slots).toHaveLength(22);
    expect(p.slots.reduce((v,s) => v+s.points,0)).toBe(150);
    expect(['calculus','linear','probability'].map(subject => p.slots.filter(s => s.subject === subject).reduce((v,s) => v+s.points,0))).toEqual([86,32,32]);
    expect(p.slots.slice(0,10).map(s => s.subject)).toEqual(['calculus','calculus','calculus','calculus','linear','linear','linear','probability','probability','probability']);
    expect(parsePaper(p)).toEqual(p);
  });
  it('reproduces selection, preserves locks, leaves deficits and never repeats', () => {
    const bank = createSampleBank();
    const p = fixture();
    const a = fillPaper(bank,p);
    expect(fillPaper(bank,p)).toEqual(a);
    expect(a.slots.filter(s => s.snapshot)).toHaveLength(2);
    expect(slotProblems(a).filter(Boolean)).toHaveLength(20);
    const index = a.slots.findIndex(s => s.snapshot?.id === bank.items[0].id);
    a.slots[index].locked = true;
    expect(fillPaper({ ...bank, items: [] },a).slots[index]).toEqual(a.slots[index]);
    expect(() => fillPaper(bank,a,[index])).toThrow('解锁');
    expect(new Set(a.slots.flatMap(s => s.snapshot ? [s.snapshot.id] : [])).size).toBe(2);
  });
  it('matches classification, explicit subjects, approval and priority', () => {
    const p = fixture(); const q = createSampleBank().items[0]; const slot = p.slots[16];
    expect(matchesSlot(q,slot,p)).toBe(true);
    expect(matchesSlot({ ...q, chapterId: null },slot,p)).toBe(false);
    expect(matchesSlot({ ...q, reviewStatus: 'pending' },slot,p)).toBe(false);
    expect(classify({ ...q, questionTypes: ['解答','证明'] },p.rules)).toBe('answer');
    expect(classify({ ...q, questionTypes: ['解答','选择'] },p.rules)).toBeNull();
    expect(classify({ ...q, questionTypes: ['未知'] },p.rules)).toBeNull();
    p.filters.priorities = ['must']; expect(matchesSlot(q,slot,p)).toBe(false);
    p.filters.priorities = ['unset']; expect(matchesSlot({ ...q, reviewPriority: null },slot,p)).toBe(true);
  });
  it('filters practice scopes using OR within and AND across fields', () => {
    const p = fixture(); p.kind = 'practice'; p.slots = makeSlots('practice',[0,0,1]);
    const q = createSampleBank().items[0];
    p.filters = { priorities: [], chapters: [q.chapterId!,'other'], topics: ['不存在',q.topics[0]], books: [q.source!.bookId!] };
    expect(matchesSlot(q,p.slots[0],p)).toBe(true);
    p.filters.books = ['wrong']; expect(matchesSlot(q,p.slots[0],p)).toBe(false);
    p.filters.books = []; expect(matchesSlot(q,p.slots[0],p)).toBe(true);
  });
  it('prefers topic diversity before seed ties and excludes used/current replacement IDs', () => {
    const bank = createSampleBank(); const q = bank.items[0];
    bank.items = [{ ...q, id: 'a', topics: ['极限'] },{ ...q,id:'b',topics:['极限'] },{ ...q,id:'c',topics:['积分'] }];
    const p = fixture(); p.kind = 'practice'; p.slots = makeSlots('practice',[0,0,2]);
    p.slots[0].snapshot = bank.items[0]; p.slots[0].locked = true;
    const next = fillPaper(bank,p);
    expect(next.slots[1].snapshot?.id).toBe('c');
    expect(candidates(bank,next,1).map(q => q.id)).toEqual(['b']);
    expect(fillPaper(bank,next,[1],'b').slots[1].snapshot?.id).toBe('b');
    expect(() => fillPaper(bank,next,[1],'a')).toThrow('不符合');
    expect(() => fillPaper({ ...bank, items: [bank.items[0]] },next,[1])).toThrow('没有');
    p.slots[1].snapshot = bank.items[0]; expect(slotProblems(p)[1]).toBe('重复题目');
    p.filters.priorities = ['must']; expect(slotProblems(p)[0]).toBe('不符合当前规则');
  });
  it('rejects malformed contracts, fixed-template changes and invalid snapshots', () => {
    const p = fixture();
    for (const patch of [{ version: 99 },{ id: '../outside' },{ title: '' },{ filters: {} },{ slots: [] },{ rules: { version: 1, chapters: { x: 'auto' }, types: {} } }]) expect(() => parsePaper({ ...p,...patch })).toThrow();
    p.slots[0].points = 6; expect(() => parsePaper(p)).toThrow('固定');
    expect(() => parsePaperSettings({ version: 1, chapters: {}, types: { x: 'bad' } })).toThrow();
    p.kind = 'practice'; p.slots = makeSlots('practice',[1,0,0]); p.slots[0].snapshot = {} as never;
    expect(() => parsePaper(p)).toThrow();
  });
  it('renders isolated question and solution papers with score, spacing and source privacy', () => {
    const p = fixture(); const q = createSampleBank().items[0];
    p.slots.forEach(s => { s.snapshot = q; s.sourceText = '秘密来源'; });
    p.slots[17].space = 'page';
    const questions = buildPaperLatex(p,false); const solutions = buildPaperLatex(p,true);
    expect(questions).toContain('180 分钟'); expect(questions).toContain('0.42\\textheight'); expect(questions).toContain('0.85\\textheight');
    expect(questions).not.toContain(q.modules.solution.tex); expect(questions).not.toContain(q.modules.note.tex); expect(questions).not.toContain('秘密来源');
    expect(solutions).toContain(q.modules.solution.tex); expect(solutions).not.toContain(q.modules.note.tex);
    p.slots[0].snapshot = { ...q, modules: { ...q.modules, solution: { tex: '' } } };
    expect(buildPaperLatex(p,true)).toContain('本题暂无解析');
    p.title = '练习 & 50%'; expect(buildPaperLatex(p,false)).toContain('练习 \\& 50\\%');
  });
});
