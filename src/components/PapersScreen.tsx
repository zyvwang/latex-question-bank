import type { CandidateRef } from '../../shared/variants.js';
import { VariantManager } from './VariantManager.js';
import { PaperTopicReview } from './PaperTopicReview.js';
import type { TopicsResponse, TopicStamp } from '../../shared/paper-topics.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { slotProblems, type PaperList, type PaperSettings, type PaperSnapshot } from '../../shared/papers.js';
import type { ExportResponse } from '../../shared/types.js';
import { fetchBank, paperRequest, revealExportFolder } from '../api/client.js';
import { useLifecycle, useQuestions } from '../context/questionBankContexts.js';
import { usePaperDraft } from '../hooks/usePaperDraft.js';
import { PaperEditor } from './PaperEditor.js';
import { PaperSettingsEditor } from './PaperSettingsEditor.js';
import controls from '../styles/controls.module.css';
import styles from './PapersScreen.module.css';

export function PapersScreen({ workspace, visible, variantFocus = null }: { workspace: string; visible: boolean; variantFocus?: { familyId: string } | null }) {
  const { bank } = useQuestions();
  const lifecycle = useLifecycle();
  const model = usePaperDraft(workspace);
  const [list,setList] = useState<PaperList>({ papers: [], warnings: [] });
  const [settings,setSettings] = useState<{ settings: PaperSettings; revision: string } | null>(null);
  const [loaded,setLoaded] = useState(false);
  const [notice,setNotice] = useState('');
  const [topics,setTopics] = useState<TopicsResponse | null>(null);
  const [reviewDirty,setReviewDirty] = useState(false);
  const [external,setExternal] = useState(false);
  const refreshTopics = useCallback(async () => { setTopics(await paperRequest<TopicsResponse>('topics-read',workspace)); },[workspace]);
  const live = useRef({ model,reviewDirty }); live.current = { model,reviewDirty };
  const topicsBank = useRef(bank);
  const [result,setResult] = useState<ExportResponse | null>(null);
  const refresh = async () => {
    const [l,s,t] = await Promise.all([paperRequest<PaperList>('list',workspace), paperRequest<{ settings: PaperSettings; revision: string }>('settings',workspace),paperRequest<TopicsResponse>('topics-read',workspace)]);
    if (!live.current.reviewDirty) setTopics(t); setList(l); setSettings(s); setLoaded(true);
  };
  useEffect(() => {
    if (!visible || loaded) return;
    let ignore = false;
    void Promise.all([paperRequest<PaperList>('list',workspace),paperRequest<{ settings: PaperSettings; revision: string }>('settings',workspace),paperRequest<TopicsResponse>('topics-read',workspace)]).then(([l,s,t]) => {
      if (!ignore) { setTopics(t); setList(l); setSettings(s); setLoaded(true); }
    }).catch(e => { if (!ignore) setNotice(String(e)); });
    return () => { ignore = true; };
  }, [visible,loaded,workspace]);
  useEffect(() => {
    if (!loaded || typeof EventSource === 'undefined') return;
    const source = new EventSource('/api/events');
    let disposed = false;
    const handler = async (event: MessageEvent<string>) => {
      let payload: { workspacePath:string; id?:string; source?:string };
      try { payload = JSON.parse(event.data); } catch { return; }
      if (payload.workspacePath !== workspace || payload.source === 'ui') return;
      const current = live.current;
      if (current.model.hasLocalWork() || current.reviewDirty) { setExternal(true); return; }
      try {
        const [l,t] = await Promise.all([paperRequest<PaperList>('list',workspace),paperRequest<TopicsResponse>('topics-read',workspace)]);
        if (disposed) return;
        if (live.current.model.hasLocalWork() || live.current.reviewDirty) { setExternal(true); return; }
        setList(l); setTopics(t);
        const saved = live.current.model.getSaved();
        if (saved && payload.id === saved.paper.id) {
          const disk = await paperRequest<PaperSnapshot>('read',workspace,{ id:saved.paper.id });
          if (!disposed && !live.current.model.hasLocalWork() && !live.current.reviewDirty && live.current.model.getSaved()?.paper.id === saved.paper.id && live.current.model.getSaved()?.revision === saved.revision) live.current.model.adopt(disk);
          else if (!disposed) setExternal(true);
        }
      } catch { if (!disposed) setExternal(true); }
    };
    source.addEventListener('paper-changed',handler);
    source.addEventListener('paper-topics-changed',handler);
    return () => { disposed = true; source.close(); };
  },[workspace,loaded]);
  useEffect(() => {
    if (!visible || !loaded || topicsBank.current === bank) return;
    if (live.current.model.hasLocalWork() || reviewDirty) { setExternal(true); return; }
    let cancelled = false;
    void paperRequest<TopicsResponse>('topics-read',workspace).then(next => {
      if (cancelled) return;
      if (live.current.reviewDirty || live.current.model.hasLocalWork()) { setExternal(true); return; }
      topicsBank.current = bank; setTopics(next);
    }).catch(e => { if (!cancelled) setNotice(String(e)); });
    return () => { cancelled = true; };
  },[bank,visible,loaded,reviewDirty,workspace]);
  if (!bank) return null;
  const current = () => { const s = model.getSaved(); if (!s) throw new Error('请先打开试卷。'); return { id: s.paper.id, revision: s.revision }; };
  const generate = (index?: number, manualId?: string | CandidateRef) => void lifecycle.flushPendingChanges().then(() => model.run(async () => {
    const snapshot = await fetchBank();
    const next = await paperRequest<PaperSnapshot>('generate',workspace,{ ...current(), bankRevision: snapshot.revision, index, ...(typeof manualId === 'object'?{manualRef:manualId}:{manualId}), topicsRevision: topics?.revision ?? '' });
    model.adopt(next); setResult(null); await refresh();
  })).catch(e => setNotice(String(e)));
  return <section hidden={!visible} id={visible ? 'main-workspace' : undefined} className={styles.screen} aria-label="组卷">
    <header className={styles.header}><div><h1>组卷</h1><p>固定数一结构，或为本轮复习编一份练习卷。</p></div><div className={styles.actions}>{(['mock','practice'] as const).map(kind => <button key={kind} disabled={model.isBusy} className={kind === 'mock' ? controls.primaryAction : controls.secondaryAction} onClick={() => void lifecycle.flushPendingChanges().then(() => model.run(async () => { model.adopt(await paperRequest<PaperSnapshot>('create',workspace,{ kind })); setResult(null); await refresh(); })).catch(e => setNotice(String(e)))}>{kind === 'mock' ? '新建模拟卷' : '新建练习卷'}</button>)}</div></header>
    {(notice || model.error) && <div role="alert" className={styles.alert}><p>{model.error || notice}</p><button className={controls.secondaryAction} onClick={() => { void model.retry().then(() => { setNotice(''); return refresh(); }).catch(e => setNotice(String(e))); }}>核对并重试</button>{model.paper && <button className={controls.secondaryAction} onClick={() => {
      if (window.confirm('载入磁盘版本会放弃当前试卷草稿，是否继续？')) void model.reload().catch(e => setNotice(String(e)));
    }}>载入磁盘版本</button>}</div>}
    {external && <div role="status" className={styles.alert}><p>试卷或分类已在外部更新，当前草稿已保留。</p><button className={controls.secondaryAction} onClick={() => { void model.flush().then(refresh).then(() => setExternal(false)).catch(e => setNotice(String(e))); }}>保存草稿并刷新列表与分类</button></div>}
    {list.warnings.map(w => <p key={w} role="alert">{w}</p>)}
    {settings && <PaperSettingsEditor bank={bank} workspace={workspace} initial={settings} onSaved={setSettings} />}
    <VariantManager workspace={workspace} visible={visible} focus={variantFocus} />
    <PaperTopicReview data={topics} workspace={workspace} refresh={refreshTopics} onDirty={setReviewDirty} />
    <div className={styles.workspace}>
      <aside className={styles.list} aria-label="试卷列表"><h2>已保存试卷 <span>{list.papers.length}</span></h2>{!list.papers.length && <p>新建试卷后，条件、题目快照和缺题草稿会保存在此工作区。</p>}{list.papers.map(p => <button key={p.id} disabled={model.isBusy} aria-current={model.paper?.id === p.id ? 'true' : undefined} className={styles.listItem} onClick={() => void model.run(async () => { model.adopt(await paperRequest<PaperSnapshot>('read',workspace,{ id: p.id })); setResult(null); })}><strong>{p.title}</strong><span>{p.kind === 'mock' ? '模拟卷' : '练习卷'} · {p.missing ? `缺 ${p.missing} 题` : '已选齐'}</span></button>)}</aside>
      <div className={styles.detail}>{model.paper ? <>
        <div className={styles.actions}><span role="status">{model.status}</span><button className={controls.tertiaryAction} disabled={model.isBusy} onClick={() => void model.run(async () => { model.adopt(await paperRequest<PaperSnapshot>('copy',workspace,current())); await refresh(); })}>复制</button><button className={controls.tertiaryAction} disabled={model.isBusy} onClick={() => void model.run(async () => { model.adopt(await paperRequest<PaperSnapshot>('copy',workspace,{ ...current(), practice: true })); await refresh(); })}>复制为练习卷</button><button className={controls.tertiaryAction} disabled={model.isBusy} onClick={() => {
          if (window.confirm(`确定删除“${model.paper!.title}”？`)) void model.run(async () => { await paperRequest('delete',workspace,current()); model.adopt(null); setResult(null); await refresh(); });
        }}>删除</button><button className={controls.primaryAction} disabled={model.isBusy || slotProblems(model.paper).some(Boolean)} onClick={() => void model.run(async () => {
          const output = await paperRequest<ExportResponse>('export',workspace,current()); setResult(output); setNotice(output.ok ? '' : '编译失败，旧输出已保留。请检查下方编译日志。');
        })}>{model.isBusy ? '处理中…' : '导出试题卷与解析卷'}</button></div>
        {result && <div className={styles.output}><p>{result.ok ? '两份 PDF 已导出' : '导出未完成'} · {result.exportPath}</p>{result.ok ? <button className={controls.secondaryAction} onClick={() => void revealExportFolder(result.exportName).catch(e => setNotice(String(e)))}>打开导出文件夹</button> : <details><summary>编译日志</summary><pre>{result.results.questions.log}\n{result.results.full.log}</pre></details>}</div>}
        <PaperEditor workspace={workspace} paper={model.paper} bank={bank} edit={p => { model.edit(p); setResult(null); }} busy={model.isBusy} groups={Object.fromEntries((topics?.rows ?? []).filter(r => r.approved && r.state !== 'stale').map(r => [r.item.id,r.approved as TopicStamp]))} applyTopics={() => void model.run(async () => { model.adopt(await paperRequest<PaperSnapshot>('apply-topics',workspace,{ ...current(),topicsRevision:topics?.revision ?? '' })); })} generate={generate} applyRules={() => { void lifecycle.flushPendingChanges().then(() => model.run(async () => { const saved = await paperRequest<{ settings: PaperSettings; revision: string }>('settings',workspace); setSettings(saved); const current = model.getSaved()?.paper; if (current) model.edit({ ...current, rules: structuredClone(saved.settings) }); })).catch(e => setNotice(String(e))); }} />
      </> : <div className={styles.welcome}><h2>按复习目标选题</h2><p>模拟卷严格保持题型、学科和分值。练习卷可限定范围、调整题量。仅使用已批准题目，候选不足时保留缺题，不重复、不放宽条件。</p><p>模拟卷结构依据已核对的 2021 至 2026 年数学一共同结构。</p></div>}</div>
    </div>
  </section>;
}
