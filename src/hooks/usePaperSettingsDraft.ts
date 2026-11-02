import { useCallback, useEffect, useRef, useState } from 'react';
import type { PaperSettings } from '../../shared/papers.js';
import { paperRequest, waitForPaperWrites } from '../api/client.js';
import { registerPaperBoundary } from '../utils/pendingPaperChanges.js';

type Snapshot = { settings: PaperSettings; revision: string };
export function usePaperSettingsDraft(workspace: string, initial: Snapshot, onSaved: (s: Snapshot) => void) {
  const [value,setValue] = useState(initial.settings);
  const [error,setError] = useState('');
  const [saving,setSaving] = useState(false);
  const saved = useRef(initial);
  const latest = useRef(value);
  const issue = useRef('');
  const flight = useRef<Promise<void> | null>(null);
  const onSavedRef = useRef(onSaved); onSavedRef.current = onSaved;
  useEffect(() => {
    if (!flight.current && !issue.current && latest.current === saved.current.settings && initial.revision !== saved.current.revision) {
      saved.current = initial;
      latest.current = initial.settings;
      setValue(initial.settings);
    }
  },[initial]);
  const edit = (v: PaperSettings) => { latest.current = v; setValue(v); };
  const flush = useCallback((): Promise<void> => {
    if (flight.current) return flight.current;
    if (issue.current) return Promise.reject(new Error(issue.current));
    const run = async () => {
      while (latest.current !== saved.current.settings) {
        const next = latest.current;
        setSaving(true);
        saved.current = await paperRequest<Snapshot>('save-settings',workspace,{ settings: next,revision: saved.current.revision });
        if (latest.current === next) { latest.current = saved.current.settings; setValue(latest.current); }
        onSavedRef.current(saved.current);
      }
    };
    flight.current = run().catch(e => {
      issue.current = e instanceof Error ? e.message : '组卷映射保存失败。'; setError(issue.current); throw e;
    }).finally(() => { flight.current = null; setSaving(false); });
    return flight.current;
  },[workspace]);
  useEffect(() => registerPaperBoundary(flush),[flush]);
  useEffect(() => {
    if (issue.current) return;
    const timer = window.setTimeout(() => { void flush().catch(() => undefined); },350);
    return () => window.clearTimeout(timer);
  },[value,flush]);
  const retry = async () => {
    await waitForPaperWrites();
    const disk = await paperRequest<Snapshot>('settings',workspace);
    if (JSON.stringify(disk.settings) === JSON.stringify(latest.current)) { saved.current = disk; latest.current = disk.settings; setValue(disk.settings); onSavedRef.current(disk); }
    else if (disk.revision !== saved.current.revision) throw new Error('组卷映射存在冲突，请核对工作区 papers/settings.json 后重试。');
    issue.current = ''; setError(''); await flush();
  };
  return { value, setValue: edit, error, saving, flush, retry, setError };
}
