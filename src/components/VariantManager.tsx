import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { examKinds, kindNames, standardKinds, canConvert, type ExamKind, type FamilyView, type VariantContent, type VariantOverview, type VariantRow } from '../../shared/variants.js';
import { fetchBank, variantRequest, waitForPaperWrites, ApiRequestError } from '../api/client.js';
import { useLifecycle, useQuestions } from '../context/questionBankContexts.js';
import { registerPaperBoundary } from '../utils/pendingPaperChanges.js';
import { LatexPreview } from './LatexPreview.js';
import controls from '../styles/controls.module.css';
import styles from './PapersScreen.module.css';
const LatexEditor=lazy(() => import('./LatexEditor.js'));
interface Draft { variantId:string; versionRevision?:string; content:VariantContent }
export function VariantManager({workspace,visible,focus=null}:{workspace:string;visible:boolean;focus?:{familyId:string}|null}) {
  const {bank,activeItem}=useQuestions(); const lifecycle=useLifecycle();
  const [overview,setOverview]=useState<VariantOverview|null>(null); const [view,setView]=useState<FamilyView|null>(null);
  const [draft,setDraft]=useState<Draft|null>(null); const [selected,setSelected]=useState<string[]>([]);
  const [confirmBasis,setConfirmBasis]=useState(false); const [correction,setCorrection]=useState<ExamKind>('C'); const [reason,setReason]=useState('');
  const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const [external,setExternal]=useState(false);
  const [rootId,setRootId]=useState(''); const [query,setQuery]=useState('');
  const state=useRef({view,draft,overview,selected}); state.current={view,draft,overview,selected};
  const flight=useRef<Promise<void>|null>(null); const uncertain=useRef(false); const mutation=useRef(false);
  const refresh=useCallback(async (id?:string) => {
    const next=await variantRequest<VariantOverview>('list',workspace); setOverview(next);
    if (id) {const nextView=await variantRequest<FamilyView>('read',workspace,{familyId:id});setView(nextView);setCorrection(nextView.family.originalKind);if (uncertain.current && state.current.draft) {const row=nextView.rows.find(r => r.entry.id === state.current.draft?.variantId);if (row) {const d={...state.current.draft,versionRevision:row.revision.id};state.current.draft=d;setDraft(d);}}}
  },[workspace]);
  useEffect(() => {if (visible && !overview) void refresh().catch(e => setError(String(e)));},[visible,overview,refresh]);
  useEffect(() => {
    if (!overview || typeof EventSource === 'undefined') return;
    const source=new EventSource('/api/events');
    const changed=(event:MessageEvent<string>) => {
      let payload; try {payload=JSON.parse(event.data) as {workspacePath:string;source?:string};} catch {return;}
      if (payload.workspacePath !== workspace || payload.source === 'ui') return;
      if (state.current.draft || state.current.selected.length || flight.current || uncertain.current) setExternal(true);
      else void refresh(state.current.view?.family.id).catch(e => setError(String(e)));
    };
    source.addEventListener('variants-changed',changed); source.addEventListener('bank-changed',changed);
    return () => source.close();
  },[workspace,refresh,!!overview]);
  const previousBank=useRef(bank);
  useEffect(() => {
    if (previousBank.current === bank) return;previousBank.current=bank;
    if (state.current.draft || flight.current || mutation.current) {setExternal(true);return;}
    if (state.current.overview) void refresh(state.current.view?.family.id).catch(e => setError(String(e)));
  },[bank,refresh]);
  const save=useCallback(async () => {
    if (flight.current) {await flight.current; if (state.current.draft) return save(); return;}
    if (uncertain.current) throw new Error('版本写入结果尚未核对，请先读取磁盘版本。');
    const current=state.current; if (!current.draft || !current.view) return;
    const captured=current.draft;
    const operation=(async () => {
      setBusy(true);
      try {
        const snapshot=await fetchBank();
        const result=await variantRequest<{family:FamilyView['family'];revision:string}>(captured.versionRevision?'revise':'propose',workspace,{familyId:current.view!.family.id,revision:current.view!.revision,bankRevision:snapshot.revision,rootFingerprint:current.view!.rootFingerprint,variantId:captured.variantId,versionRevision:captured.versionRevision,content:captured.content});
        const next=await variantRequest<FamilyView>('read',workspace,{familyId:result.family.id});
        state.current.view=next; setView(next);
        if (state.current.draft === captured) {state.current.draft=null;setDraft(null);}
        else if (state.current.draft) {const revised={...state.current.draft,versionRevision:next.rows.find(r => r.entry.id === captured.variantId)?.revision.id};state.current.draft=revised;setDraft(revised);}
        setError(''); await refresh(result.family.id);
      } catch(e) {
        if (e instanceof ApiRequestError && e.code === 'WRITE_RESULT_UNKNOWN') uncertain.current=true;
        setError(String(e)); throw e;
      } finally {setBusy(false);}
    })(); flight.current=operation;
    try {await operation;} finally {flight.current=null;}
  },[workspace,refresh]);
  const saveRef=useRef(save);saveRef.current=save;
  useEffect(() => registerPaperBoundary(async () => {if (mutation.current || uncertain.current) throw new Error('版本操作尚未完成，请先读取磁盘并核对结果。');await saveRef.current();}),[]);
  const run=async (action:string,body:Record<string,unknown>={}) => {
    if (mutation.current || flight.current) return;
    try {
      await lifecycle.flushPendingChanges();
      if (flight.current || mutation.current) return;
      const v=state.current.view; const o=state.current.overview;
      mutation.current=true;setBusy(true);
      const snapshot=await fetchBank();
      await variantRequest(action,workspace,{configRevision:o?.configRevision,familyId:v?.family.id,revision:v?.revision,bankRevision:snapshot.revision,rootFingerprint:v?.rootFingerprint,...body});
      if (action === 'correct-type') await lifecycle.reloadExternalBank({confirmed:true});
      setSelected([]);setReason('');setError('');await refresh(v?.family.id);
    } catch(e) {if (e instanceof ApiRequestError && e.code === 'WRITE_RESULT_UNKNOWN') uncertain.current=true;setError(String(e));}
    finally {mutation.current=false;setBusy(false);}
  };
  const open=async (id:string) => {try {await save();await refresh(id);setSelected([]);setConfirmBasis(false);} catch(e) {setError(String(e));}};
  const openRef=useRef(open);openRef.current=open;
  useEffect(() => {
    if (!focus || !visible) return;
    void openRef.current(focus.familyId).then(() => {
      const panel=document.getElementById('variant-manager');
      if (panel instanceof HTMLDetailsElement) {panel.open=true;panel.scrollIntoView();}
    });
  },[focus,visible]);
  if (!bank) return null;
  const roots=bank.items.filter(q => standardKinds(q).length === 1 && !overview?.families.some(f => f.family.rootId === q.id) && `${q.id} ${q.source?.label ?? ''} ${q.modules.question.tex}`.includes(query));
  const enroll=async () => {
    if (mutation.current || flight.current) return;
    try {
      await lifecycle.flushPendingChanges();mutation.current=true;setBusy(true);const snapshot=await fetchBank();
      const root=snapshot.bank.items.find(q => q.id === (rootId || activeItem?.id)); if (!root) throw new Error('请选择原题。');
      const result=await variantRequest<{family:FamilyView['family']}>('create-family',workspace,{rootId:root.id,originalKind:standardKinds(root)[0],bankRevision:snapshot.revision});
      await refresh(result.family.id);setError('');
    } catch(e) {if (e instanceof ApiRequestError && e.code === 'WRITE_RESULT_UNKNOWN') uncertain.current=true;setError(String(e));} finally {mutation.current=false;setBusy(false);}
  };
  const edit=(row?:VariantRow) => {
    if (!view?.root) return;
    const content=row ? structuredClone(row.revision.content) : {targetKind:view.family.originalKind,question:view.root.modules.question.tex,solution:view.root.modules.solution.tex,answer:''};
    setDraft({variantId:row?.entry.id ?? crypto.randomUUID(),versionRevision:row?.revision.id,content});
  };
  const review=(action:string) => run('review',{entries:selected.map(id => ({variantId:id,versionRevision:view?.rows.find(r => r.entry.id === id)?.revision.id,action,confirmCurrentBasis:confirmBasis}))});
  return <details className={`${styles.settings} ${styles.variantManager}`} id="variant-manager"><summary>原题与版本 · {overview?.config.enabled?'已开启':'默认关闭'}</summary>
    <p>只转换题型表达，保留原题全部条件、数值与求解目标。ABC 可相互转换；证明题保持原题，不改写。版本单独审阅；每卷主动启用，同族最多选一道。</p>
    <label><input type="checkbox" checked={overview?.config.enabled ?? false} disabled={!overview || busy || !!draft} onChange={e => void run('set-enabled',{enabled:e.target.checked})} />开启本工作区版本管理</label>
    <label><input type="checkbox" checked={overview?.config.agentAutoEnroll === true} disabled={!overview?.config.enabled || busy || !!draft} onChange={e => void run('set-agent-auto-enroll',{allowed:e.target.checked})} />允许 Agent 自动纳管新题和指定旧题</label>
    <p>授权后，Agent 可联合录入原题与多个版本。原始题型受保护；新增内容仍需用户审阅。</p>
    {error && <p role="alert">{error} 草稿保留，核对后可重试。</p>}{external && <p role="status">外部内容已变化，当前草稿保留。保存前请核对原题。</p>}
    {overview?.warnings.map(w => <p role="alert" key={w}>{w}</p>)}
    <button className={controls.tertiaryAction} disabled={busy} onClick={() => void waitForPaperWrites().then(() => refresh(view?.family.id)).then(() => {uncertain.current=false;setExternal(false);setError('');}).catch(e => setError(String(e)))}>读取磁盘并核对结果</button>
    {overview?.config.enabled && <details open={!view}><summary>纳入原题</summary><fieldset className={styles.rules} disabled={busy || !!draft}><legend>纳入原题</legend><p>纳入后原始标准题型受保护。需要修改时使用下方专门纠错；普通编辑和 Agent 不能改动。</p><div className={styles.fields}><label>查找原题<input value={query} onChange={e => setQuery(e.target.value)} /></label><label>原题<select aria-label="原题" value={rootId || (roots.some(q => q.id === activeItem?.id)?activeItem?.id:'')} onChange={e => setRootId(e.target.value)}><option value="">选择唯一标准题型的原题</option>{roots.map(q => <option value={q.id} key={q.id}>{q.source?.label || q.id} · {q.questionTypes.join('、')} · {q.modules.question.tex.slice(0,60)}</option>)}</select></label></div><button className={controls.secondaryAction} disabled={!roots.some(q => q.id === (rootId || activeItem?.id))} onClick={() => void enroll()}>确认原始题型并纳入</button></fieldset></details>}
    {!!overview?.families.length && <label>原题族<select value={view?.family.id ?? ''} disabled={busy} onChange={e => void open(e.target.value)}><option value="">选择原题族</option>{overview.families.map(f => <option key={f.family.id} value={f.family.id}>{bank.items.find(q => q.id === f.family.rootId)?.source?.label || f.family.rootId} · {kindNames[f.family.originalKind]} · {f.family.versions.length} 个版本</option>)}</select></label>}
    {view && <>
      {view.warning && <p role="alert">{view.warning}</p>}
      <h3>当前原题 · {kindNames[view.family.originalKind]} · 第 {view.family.typeEpoch} 次题型确认</h3>
      <LatexPreview compact assetBaseUrl={view.root?undefined:'/api/variants/assets'} tex={(view.root ?? view.family.baseline)?.modules.question.tex ?? '原题缺失'} assets={(view.root ?? view.family.baseline)?.assets ?? []} />
      <details><summary>当前原题解析</summary><LatexPreview compact assetBaseUrl={view.root?undefined:'/api/variants/assets'} tex={(view.root ?? view.family.baseline)?.modules.solution.tex || '暂无解析'} assets={(view.root ?? view.family.baseline)?.assets ?? []} /></details>
      <div className={styles.actions}><button className={controls.secondaryAction} disabled={busy || !!draft || !overview?.config.enabled || view.blocked || !view.root} onClick={() => edit()}>录入表达版本</button><span>{view.rows.length} 个版本</span></div>
      {draft && <fieldset className={styles.rules} disabled={busy}><legend>{draft.versionRevision?'修订版本':'新版本'} · 保存后待审阅</legend><label>目标题型<select value={draft.content.targetKind} onChange={e => setDraft({...draft,content:{...draft.content,targetKind:e.target.value as ExamKind}})}>{examKinds.filter(k => canConvert(view.family.originalKind,k)).map(k => <option key={k} value={k}>{k} · {kindNames[k]}</option>)}</select></label>
        {(['question','answer','solution'] as const).map((key,i) => <div key={key}><p>{['完整题面','答案','完整解析'][i]}</p><div role="group" aria-label={['完整题面','答案','完整解析'][i]} className={styles.variantCode}><Suspense fallback={<p>载入编辑器…</p>}><LatexEditor value={draft.content[key]} onChange={value => setDraft(d => d ? {...d,content:{...d.content,[key]:value}} : d)} /></Suspense></div></div>)}
        {draft.content.targetKind === 'A' && <label>正确选项<select value={draft.content.choiceKey ?? ''} onChange={e => setDraft({...draft,content:{...draft.content,choiceKey:e.target.value}})}><option value="">请选择</option>{['A','B','C','D'].map(k => <option key={k}>{k}</option>)}</select></label>}
        <p>选择题使用一组四项 \choices；填空题包含 \blank。附件沿用原题或当前版本的独立副本。</p><button className={controls.primaryAction} onClick={() => void save().catch(() => undefined)}>保存待审阅版本</button><button className={controls.tertiaryAction} onClick={() => {if (window.confirm('放弃尚未提交的版本草稿？')) {state.current.draft=null;setDraft(null);}}}>放弃草稿</button>
      </fieldset>}
      {view.rows.map(row => <article className={styles.topicRow} key={row.entry.id}>
        <div className={styles.actions}><label><input type="checkbox" aria-label={`勾选版本 ${row.entry.id}`} checked={selected.includes(row.entry.id)} disabled={busy || !!draft} onChange={e => setSelected(ids => e.target.checked?[...ids,row.entry.id]:ids.filter(id => id !== row.entry.id))} />{kindNames[row.revision.content.targetKind]}版本</label><strong>{row.state}</strong><span>{row.entry.id}</span><button className={controls.tertiaryAction} disabled={busy || !!draft || !overview?.config.enabled || view.blocked || !view.root} onClick={() => edit(row)}>修订</button></div>
        <div className={styles.variantCompare}><div><h4>生成时原题</h4><LatexPreview compact assetBaseUrl="/api/variants/assets" tex={row.revision.base.modules.question.tex} assets={row.revision.base.assets} /></div><div><h4>版本题面</h4><LatexPreview compact assetBaseUrl="/api/variants/assets" tex={row.revision.content.question} assets={row.revision.item.assets} /></div></div>
        <details><summary>答案、解析与修订历史（{row.history.length} 次）</summary><LatexPreview compact assetBaseUrl="/api/variants/assets" tex={`答案：${row.revision.content.answer}\n\n${row.revision.content.solution}`} assets={row.revision.item.assets} />{row.history.map(h => <details key={h.id}><summary>{h.createdAt} · {h.generator} · {h.id}</summary><LatexPreview compact assetBaseUrl="/api/variants/assets" tex={`${h.content.question}\n\n答案：${h.content.answer}\n\n${h.content.solution}`} assets={h.item.assets} /></details>)}<p>审阅记录：{row.entry.reviews?.map(r => `${r.at} ${r.action}（第${r.epoch}次题型确认）`).join('；') || '尚未审阅'}</p></details>
      </article>)}
      <label><input type="checkbox" checked={confirmBasis} onChange={e => setConfirmBasis(e.target.checked)} />我已对照当前原题，确认所选版本保留全部条件、数值及求解目标（基准变化时必选）</label>
      <div className={styles.actions}>{[['approve','批准勾选版本'],['reject','拒绝勾选版本'],['withdraw','撤回勾选版本']].map(([action,label]) => <button className={action==='approve'?controls.primaryAction:controls.secondaryAction} key={action} disabled={busy || !!draft || !selected.length || !overview?.config.enabled || view.blocked} onClick={() => void review(action)}>{label}</button>)}</div>
      <details><summary>专门纠错：原始题型</summary>{view.family.corrections.length > 0 && <button className={controls.tertiaryAction} disabled={busy} onClick={() => void lifecycle.reloadExternalBank().catch(e => setError(String(e)))}>载入题库中的纠错结果</button>}<p>此操作同时修改原题标准题型，并使已有版本待复核。不会更改题目数学内容。</p><label>正确题型<select value={correction} disabled={busy} onChange={e => setCorrection(e.target.value as ExamKind)}>{examKinds.map(k => <option value={k} key={k}>{kindNames[k]}</option>)}</select></label><label>纠错理由<input value={reason} maxLength={1000} disabled={busy} onChange={e => setReason(e.target.value)} /></label><button className={controls.secondaryAction} disabled={busy || !reason.trim() || !!draft || !view.root} onClick={() => {if (window.confirm('确认纠正原始题型并使已有版本待复核？')) void run('correct-type',{originalKind:correction,reason});}}>确认纠错并标记待复核</button>{view.family.corrections.map((c,i) => <p key={i}>{c.at} · {c.from} → {c.to} · {c.reason}</p>)}</details>
      {!!view.family.refusals.length && <details><summary>不适合转换的记录（{view.family.refusals.length}）</summary>{view.family.refusals.map((r,i) => <p key={i}>{kindNames[r.targetKind]} · {r.reason} · {r.at}</p>)}</details>}
    </>}
  </details>;
}
