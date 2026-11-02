import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PaperEditor } from '../../src/components/PaperEditor.js';
import { defaultPaperSettings, makeSlots, type Paper } from '../../shared/papers.js';
import { bank } from '../fixtures/app-ui.js';

vi.mock('../../src/components/LatexPreview.js', () => ({ LatexPreview: ({ tex }: { tex: string }) => <div>{tex}</div> }));
function fixture(): Paper { return { version: 3, useVariants: false,quota:{ enabled:false,blueprintId:'math1-2021-2025-v1' },id:'paper',kind:'practice',title:'练习',seed:'seed',filters:{ priorities:[],chapters:[],topics:[],books:[] },rules:defaultPaperSettings(),latex:bank.settings,slots:makeSlots('practice',[1,1,1]),createdAt:'now',updatedAt:'now' }; }
function setup(p = fixture()) { const edit = vi.fn(); const generate = vi.fn(); const applyRules = vi.fn(); render(<PaperEditor paper={p} bank={{ ...bank,items: bank.items.map(q => ({ ...q,reviewStatus:'approved',questionTypes:['选择'] })) }} edit={edit} generate={generate} applyRules={applyRules} busy={false} />); return { edit,generate,applyRules,p }; }
describe('paper editor', () => {
  it('keeps selections while changing filters, seed and layout', () => {
    const p = fixture(); p.slots[0].snapshot = { ...bank.items[0],questionTypes:['选择'] };
    const { edit,applyRules } = setup(p);
    fireEvent.change(screen.getByLabelText('标题'),{ target:{ value:'新标题' } }); expect(edit.mock.lastCall?.[0].slots[0].snapshot).toEqual(p.slots[0].snapshot);
    fireEvent.change(screen.getByLabelText('随机种子'),{ target:{ value:'new' } }); expect(edit.mock.lastCall?.[0].seed).toBe('new');
    fireEvent.click(screen.getByLabelText('必须复习')); expect(edit.mock.lastCall?.[0].filters.priorities).toEqual(['must']);
    const chapter = screen.getByLabelText('章节范围') as HTMLSelectElement; chapter.options[0].selected = true; fireEvent.change(chapter); expect(edit.mock.lastCall?.[0].filters.chapters).toEqual([bank.chapters[0].id]);
    const topic = screen.getByLabelText('考点范围') as HTMLSelectElement; topic.options[0].selected = true; fireEvent.change(topic); expect(edit.mock.lastCall?.[0].filters.topics).toEqual(['极限']);
    fireEvent.change(screen.getByLabelText('第1题分值'),{ target:{ value:'8' } }); expect(edit.mock.lastCall?.[0].slots[0].points).toBe(8);
    fireEvent.change(screen.getByLabelText('第1题留白'),{ target:{ value:'page' } }); expect(edit.mock.lastCall?.[0].slots[0].space).toBe('page');
    fireEvent.click(screen.getAllByLabelText('锁题')[0]); expect(edit.mock.lastCall?.[0].slots[0].locked).toBe(true);
    fireEvent.click(screen.getByText('应用已保存映射')); expect(applyRules).toHaveBeenCalled();
  });
  it('adjusts practice counts, confirms removals and preserves existing slots', () => {
    const { edit,p } = setup();
    fireEvent.change(screen.getByLabelText('选择题题量'),{ target:{ value:'2' } });
    expect(edit.mock.lastCall?.[0].slots.filter((s: { section: string }) => s.section === 'choice')).toHaveLength(2);
    expect(edit.mock.lastCall?.[0].slots[0]).toEqual(p.slots[0]);
    vi.spyOn(window,'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const calls = edit.mock.calls.length;
    fireEvent.change(screen.getByLabelText('填空题题量'),{ target:{ value:'0' } }); expect(edit).toHaveBeenCalledTimes(calls);
    fireEvent.change(screen.getByLabelText('填空题题量'),{ target:{ value:'0' } }); expect(edit.mock.lastCall?.[0].slots.some((s: { section: string }) => s.section === 'blank')).toBe(false);
    fireEvent.change(screen.getByLabelText('选择题题量'),{ target:{ value:'101' } }); expect(edit).toHaveBeenCalledTimes(calls+1);
  });
  it('offers only valid unused candidates for manual selection and invokes single replacement', () => {
    const { generate } = setup();
    fireEvent.click(screen.getAllByText('手动选入')[0]);
    fireEvent.change(screen.getByLabelText('搜索候选'),{ target:{ value:'矩阵' } });
    fireEvent.click(screen.getByRole('button',{ name:/求矩阵秩/ }));
    expect(generate).toHaveBeenCalledWith(0,'matrix');
    fireEvent.click(screen.getAllByText('换题')[0]); expect(generate).toHaveBeenCalledWith(0);
    fireEvent.click(screen.getByText('重抽未锁定题目')); expect(generate).toHaveBeenCalledWith();
    fireEvent.click(screen.getAllByText('手动选入')[1]); expect(screen.getByText('没有符合条件且尚未入卷的候选题。')).toBeVisible();
  });
  it('reports conflicts and disables fixed mock scores and locked replacement controls', () => {
    const p = fixture(); p.kind = 'mock'; p.slots = makeSlots('mock'); p.slots[0].locked = true;
    render(<PaperEditor paper={p} bank={{ ...bank,items:[{ ...bank.items[0],questionTypes:['选择','解答'] }] }} edit={vi.fn()} generate={vi.fn()} applyRules={vi.fn()} busy={false} />);
    expect(screen.getByRole('status')).toHaveTextContent('跨部分题型冲突');
    const first = screen.getAllByRole('article')[0];
    expect(within(first).getByRole('button',{ name:'换题' })).toBeDisabled();
    expect(screen.getByLabelText('第1题分值')).toBeDisabled();
    expect(screen.getAllByText('缺题')).toHaveLength(22);
  });
});

it('opts into primary-topic quotas, shows inventory and preserves questions across seed changes', () => {
  const p = fixture(); p.kind = 'mock'; p.slots = makeSlots('mock');
  const edit = vi.fn(); const apply = vi.fn();
  const { rerender } = render(<PaperEditor paper={p} bank={bank} edit={edit} generate={vi.fn()} applyRules={vi.fn()} applyTopics={apply} busy={false} />);
  fireEvent.click(screen.getByLabelText('启用综合考点配额'));
  const configured = edit.mock.lastCall![0] as Paper;
  expect(configured.slots.every(s => s.requiredGroup)).toBe(true);
  const q = { ...bank.items[0],questionTypes:['选择'] };
  const stamp = {groupId:configured.slots[0].requiredGroup!,fingerprint:'a'.repeat(64)};
  configured.slots[0].snapshot = q; configured.slots[0].topic = stamp;
  rerender(<PaperEditor paper={configured} bank={{...bank,items:[q]}} groups={{[q.id]:stamp}} edit={edit} generate={vi.fn()} applyRules={vi.fn()} applyTopics={apply} busy={false} />);
  expect(screen.getByRole('table',{name:'本卷考点配额'})).toBeInTheDocument();
  expect(screen.getByText('可用候选')).toBeInTheDocument();
  fireEvent.click(screen.getByText('应用最新主考点分类')); expect(apply).toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('随机种子'),{target:{value:'another-seed'}});
  expect(edit.mock.lastCall![0].slots[0].snapshot).toEqual(q);
  expect(edit.mock.lastCall![0].seed).toBe('another-seed');
  fireEvent.click(screen.getByLabelText('启用综合考点配额'));
  expect(edit.mock.lastCall![0].slots.every((s:{requiredGroup:unknown}) => s.requiredGroup === null)).toBe(true);
});
