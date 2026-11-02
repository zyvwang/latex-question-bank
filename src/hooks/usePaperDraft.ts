import { useCallback, useEffect, useRef, useState } from 'react';
import type { Paper, PaperSnapshot } from '../../shared/papers.js';
import { ApiRequestError, paperRequest, waitForPaperWrites } from '../api/client.js';
import { registerPaperBoundary } from '../utils/pendingPaperChanges.js';

export function usePaperDraft(workspace: string) {
  const [paper, setPaper] = useState<Paper | null>(null);
  const [status, setStatus] = useState('已保存');
  const [error, setError] = useState('');
  const draft = useRef<Paper | null>(null);
  const saved = useRef<PaperSnapshot | null>(null);
  const flight = useRef<Promise<void> | null>(null);
  const issue = useRef('');
  const busy = useRef(false);
  const [isBusy, setBusy] = useState(false);
  const adopt = useCallback((snapshot: PaperSnapshot | null) => {
    saved.current = snapshot;
    draft.current = snapshot?.paper ?? null;
    setPaper(draft.current);
    issue.current = '';
    setError('');
    setStatus('已保存');
  }, []);
  const flush = useCallback((): Promise<void> => {
    if (flight.current) return flight.current;
    if (issue.current) return Promise.reject(new Error(issue.current));
    const run = async () => {
      while (draft.current && saved.current && draft.current !== saved.current.paper) {
        const next = draft.current;
        setStatus('保存中');
        const result = await paperRequest<PaperSnapshot>('save', workspace, { id: next.id, revision: saved.current.revision, paper: next });
        saved.current = result;
        if (draft.current === next) { draft.current = result.paper; setPaper(result.paper); }
      }
      setStatus('已保存');
    };
    flight.current = run().catch(e => {
      issue.current = e instanceof Error ? e.message : '试卷保存失败。';
      setError(issue.current);
      setStatus('未保存');
      throw e;
    }).finally(() => { flight.current = null; });
    return flight.current;
  }, [workspace]);
  useEffect(() => registerPaperBoundary(async () => {
    if (busy.current) throw new Error('组卷操作仍在进行，请稍后重试。');
    await flush();
  }), [flush]);
  const edit = useCallback((next: Paper) => {
    draft.current = next;
    setPaper(next);
    setStatus('未保存');
  }, []);
  useEffect(() => {
    if (!paper || issue.current) return;
    const timer = window.setTimeout(() => { void flush().catch(() => undefined); }, 350);
    return () => window.clearTimeout(timer);
  }, [paper, flush]);
  const retry = async () => {
    await waitForPaperWrites();
    if (!saved.current || !draft.current) { issue.current = ''; setError(''); return; }
    const disk = await paperRequest<PaperSnapshot>('read',workspace,{ id: saved.current.paper.id });
    // A timed out save may have committed. Reconcile content before deciding whether to replay.
    const content = (p: Paper) => JSON.stringify({ ...p, updatedAt: '' });
    if (content(disk.paper) === content(draft.current)) adopt(disk);
    else if (disk.revision === saved.current.revision) { issue.current = ''; setError(''); await flush(); }
    else { issue.current = '磁盘版本与草稿冲突。草稿已保留，可核对后载入磁盘版本。'; setError(issue.current); }
  };
  const reload = async () => {
    if (busy.current || !saved.current) return;
    busy.current = true; setBusy(true);
    try {
      await waitForPaperWrites();
      adopt(await paperRequest<PaperSnapshot>('read',workspace,{ id: saved.current.paper.id }));
    } finally { busy.current = false; setBusy(false); }
  };
  const run = async (action: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    setBusy(true);
    try { await flush(); await action(); }
    catch(e) {
      const message = e instanceof Error ? e.message : '组卷操作失败。';
      if (e instanceof ApiRequestError && e.code === 'WRITE_RESULT_UNKNOWN') issue.current = message;
      setError(message);
    }
    finally { busy.current = false; setBusy(false); }
  };
  return { paper, status, error, isBusy, adopt, edit, flush, retry, reload, run, hasLocalWork: () => busy.current || !!issue.current || !!flight.current || draft.current !== saved.current?.paper && draft.current !== null, getSaved: () => saved.current };
}
