import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaperTopicReview } from '../../src/components/PaperTopicReview.js';
import { paperRequest, ApiRequestError } from '../../src/api/client.js';
import { flushPaperChanges } from '../../src/utils/pendingPaperChanges.js';
import type { TopicsResponse } from '../../shared/paper-topics.js';
import { bank } from '../fixtures/app-ui.js';
vi.mock('../../src/api/client.js',async original => ({ ...await original<typeof import('../../src/api/client.js')>(),paperRequest:vi.fn() }));
vi.mock('../../src/components/LatexPreview.js',() => ({ LatexPreview:({tex}:{tex:string}) => <div>{tex}</div> }));
afterEach(() => vi.clearAllMocks());
function data(): TopicsResponse {
  return {revision:'topics',bankRevision:'bank',rows:Array.from({length:27},(_,i) => ({item:{...bank.items[0],id:`q${i}`,source:{bookId:null,label:`分类题 ${i}`}},approved:i === 1 ? {groupId:'C02',fingerprint:'a'.repeat(64)} : null,proposal:{groupId:'C01',fingerprint:'a'.repeat(64),reason:'主要任务是计算极限'},state:i === 1 ? 'stale' : 'pending',proposalStale:i === 1}))};
}
describe('classification review',() => {
  it('requires explicit confirmation and submits editable primary groups as one batch',async () => {
    const refresh = vi.fn().mockResolvedValue(undefined); const dirty = vi.fn();
    vi.mocked(paperRequest).mockResolvedValue({});
    render(<PaperTopicReview data={data()} workspace="/bank" refresh={refresh} onDirty={dirty} />);
    expect(paperRequest).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('主考点 q0'),{target:{value:'C02'}});
    expect(dirty).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByText('确认勾选分类'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(paperRequest).toHaveBeenCalledWith('topics-review','/bank',{bankRevision:'bank',topicsRevision:'topics',entries:[{itemId:'q0',action:'approve',groupId:'C02'}]});
    expect(dirty).toHaveBeenLastCalledWith(false);
  });
  it('keeps suggestions unapproved on rejection and paginates without losing selections',async () => {
    vi.mocked(paperRequest).mockResolvedValue({});
    render(<PaperTopicReview data={data()} workspace="/bank" refresh={vi.fn().mockResolvedValue(undefined)} onDirty={vi.fn()} />);
    fireEvent.click(screen.getByText('勾选本页建议'));
    fireEvent.click(screen.getByText('下一页'));
    expect(screen.getByLabelText('勾选分类 q26')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('勾选分类 q26'));
    fireEvent.click(screen.getByText('拒绝勾选建议'));
    await waitFor(() => expect(paperRequest).toHaveBeenCalled());
    const body = vi.mocked(paperRequest).mock.calls[0][2]!;
    expect((body.entries as {action:string}[]).every(e => e.action === 'reject')).toBe(true);
  });
  it('supports manual reconfirmation of stale classifications, search and full question preview',async () => {
    vi.mocked(paperRequest).mockResolvedValue({});
    render(<PaperTopicReview data={data()} workspace="/bank" refresh={vi.fn().mockResolvedValue(undefined)} onDirty={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('分类状态'),{target:{value:'stale'}});
    fireEvent.change(screen.getByLabelText('主考点 q1'),{target:{value:'C03'}});
    const details = screen.getByText('查看完整题面').closest('details')!;
    details.open = true; fireEvent(details,new Event('toggle'));
    fireEvent.click(screen.getByText('确认勾选分类'));
    await waitFor(() => expect(paperRequest).toHaveBeenCalledWith('topics-review','/bank',expect.objectContaining({entries:[{itemId:'q1',action:'set',groupId:'C03'}]})));
    fireEvent.change(screen.getByLabelText('查找题目'),{target:{value:'找不到'}});
    expect(screen.getByText('当前条件下没有题目。')).toBeInTheDocument();
  });
  it('blocks close while confirmation is in flight or its result is uncertain',async () => {
    let reject!: (error:Error) => void;
    vi.mocked(paperRequest).mockReturnValue(new Promise((_resolve,r) => {reject = r;}));
    render(<PaperTopicReview data={data()} workspace="/bank" refresh={vi.fn().mockResolvedValue(undefined)} onDirty={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('勾选分类 q0')); fireEvent.click(screen.getByText('确认勾选分类'));
    await expect(flushPaperChanges()).rejects.toThrow('尚未完成');
    await act(async () => {reject(new ApiRequestError('结果未知',0,'WRITE_RESULT_UNKNOWN'));});
    await expect(flushPaperChanges()).rejects.toThrow('尚未完成');
    fireEvent.click(screen.getByText('刷新并核对分类'));
    await waitFor(() => expect(screen.queryByText('结果未知')).not.toBeInTheDocument());
    await flushPaperChanges();
  });
  it('isolates damaged metadata and does not offer confirmation without rows',() => {
    const {rerender} = render(<PaperTopicReview data={null} workspace="/bank" refresh={vi.fn()} onDirty={vi.fn()} />);
    expect(screen.queryByText('确认勾选分类')).not.toBeInTheDocument();
    rerender(<PaperTopicReview data={{...data(),warning:'分类文件损坏'}} workspace="/bank" refresh={vi.fn()} onDirty={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('分类文件损坏'); expect(screen.getByText('确认勾选分类')).toBeDisabled();
  });
});
