import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { paperRequest } from '../../src/api/client.js';
import { usePaperDraft } from '../../src/hooks/usePaperDraft.js';
import { usePaperSettingsDraft } from '../../src/hooks/usePaperSettingsDraft.js';
import { flushPaperChanges } from '../../src/utils/pendingPaperChanges.js';
import { defaultPaperSettings, makeSlots, type Paper, type PaperSnapshot } from '../../shared/papers.js';
import { bank } from '../fixtures/app-ui.js';

vi.mock('../../src/api/client.js', async original => ({ ...await original<typeof import('../../src/api/client.js')>(), paperRequest: vi.fn() }));
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
function paper(): Paper {
  return { version: 3, useVariants: false, quota: { enabled: false, blueprintId: 'math1-2021-2025-v1' }, id: 'paper-one',kind: 'practice',title: '练习',seed: '42',filters: { chapters: [],topics: [],books: [],priorities: [] },rules: defaultPaperSettings(),latex: bank.settings,slots: makeSlots('practice',[1,0,0]),createdAt: 'today',updatedAt:'today' };
}
const snapshot = (p = paper(), revision = 'r1'): PaperSnapshot => ({ paper: p,revision });
describe('paper draft boundaries', () => {
  it('coalesces edits and keeps one save in flight through close/workspace flush', async () => {
    vi.useFakeTimers();
    const hook = renderHook(() => usePaperDraft('/workspace'));
    const original = paper();
    act(() => hook.result.current.adopt(snapshot(original)));
    let finish!: (s: PaperSnapshot) => void;
    vi.mocked(paperRequest).mockReturnValueOnce(new Promise(r => { finish = r; })).mockImplementationOnce(async (_a,_w,b) => snapshot(b!.paper as Paper,'r3'));
    act(() => hook.result.current.edit({ ...original,title:'第一稿' }));
    await act(() => vi.advanceTimersByTimeAsync(400));
    act(() => hook.result.current.edit({ ...original,title:'最终稿' }));
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(paperRequest).toHaveBeenCalledTimes(1);
    await act(async () => { finish(snapshot({ ...original,title:'第一稿' },'r2')); await flushPaperChanges(); });
    expect(paperRequest).toHaveBeenCalledTimes(2);
    expect(paperRequest).toHaveBeenLastCalledWith('save','/workspace',expect.objectContaining({ revision:'r2',paper: expect.objectContaining({ title:'最终稿' }) }));
    expect(hook.result.current.status).toBe('已保存');
    hook.unmount();
  });
  it('retains failures, stops automatic replay and reconciles uncertain commits', async () => {
    vi.useFakeTimers();
    const hook = renderHook(() => usePaperDraft('/workspace'));
    const next = { ...paper(),title: '保留草稿' };
    act(() => { hook.result.current.adopt(snapshot()); hook.result.current.edit(next); });
    vi.mocked(paperRequest).mockRejectedValueOnce(new Error('结果尚未确认'));
    await act(() => vi.advanceTimersByTimeAsync(400));
    await expect(flushPaperChanges()).rejects.toThrow('结果尚未确认');
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(paperRequest).toHaveBeenCalledTimes(1);
    vi.mocked(paperRequest).mockResolvedValueOnce(snapshot({ ...next,updatedAt:'tomorrow' },'r2'));
    await act(() => hook.result.current.retry());
    expect(hook.result.current.paper?.title).toBe('保留草稿');
    expect(hook.result.current.status).toBe('已保存');
    expect(paperRequest).toHaveBeenCalledTimes(2);
    hook.unmount();
  });
  it('does not overwrite a competing disk version when retrying', async () => {
    vi.useFakeTimers();
    const hook = renderHook(() => usePaperDraft('/workspace'));
    act(() => { hook.result.current.adopt(snapshot()); hook.result.current.edit({ ...paper(),title:'本地' }); });
    vi.mocked(paperRequest).mockRejectedValueOnce(new Error('冲突'));
    await act(() => vi.advanceTimersByTimeAsync(400));
    vi.mocked(paperRequest).mockResolvedValueOnce(snapshot({ ...paper(),title:'磁盘' },'external'));
    await act(() => hook.result.current.retry());
    expect(hook.result.current.paper?.title).toBe('本地');
    expect(hook.result.current.error).toContain('冲突');
    await expect(flushPaperChanges()).rejects.toThrow('冲突');
    hook.unmount();
  });
  it('blocks transitions during a selection action and unregisters on unmount', async () => {
    const hook = renderHook(() => usePaperDraft('/workspace'));
    let finish!: () => void;
    let action!: Promise<void>;
    await act(async () => { action = hook.result.current.run(() => new Promise(r => { finish = r; })); });
    await expect(flushPaperChanges()).rejects.toThrow('仍在进行');
    await act(async () => { finish(); await action; });
    await flushPaperChanges(); hook.unmount(); await flushPaperChanges();
  });
  it('flushes mapping edits before switching and preserves mapping failures', async () => {
    vi.useFakeTimers();
    const initial = { settings: defaultPaperSettings(),revision: '' }; const onSaved = vi.fn();
    const hook = renderHook(() => usePaperSettingsDraft('/workspace',initial,onSaved));
    const next = { ...initial.settings,chapters: { chapter: 'calculus' as const } };
    vi.mocked(paperRequest).mockResolvedValueOnce({ settings: next,revision: 'r1' });
    act(() => hook.result.current.setValue(next));
    await act(() => flushPaperChanges());
    expect(onSaved).toHaveBeenCalledWith({ settings: next,revision: 'r1' });
    vi.mocked(paperRequest).mockRejectedValueOnce(new Error('写入失败'));
    act(() => hook.result.current.setValue({ ...next,chapters: {} }));
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(hook.result.current.error).toBe('写入失败');
    await expect(flushPaperChanges()).rejects.toThrow('写入失败'); hook.unmount();
  });
});
