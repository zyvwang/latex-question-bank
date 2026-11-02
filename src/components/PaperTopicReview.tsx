import { useEffect, useRef, useState } from 'react';
import { groupName, topicGroups, type TopicDecision, type TopicsResponse } from '../../shared/paper-topics.js';
import { paperRequest, waitForPaperWrites, ApiRequestError } from '../api/client.js';
import { registerPaperBoundary } from '../utils/pendingPaperChanges.js';
import { LatexPreview } from './LatexPreview.js';
import controls from '../styles/controls.module.css';
import styles from './PapersScreen.module.css';

export function PaperTopicReview({ data, workspace, refresh, onDirty }: { data: TopicsResponse | null; workspace: string; refresh: () => Promise<void>; onDirty: (dirty:boolean) => void }) {
  const [selection,setSelection] = useState<Record<string,string>>({});
  const [query,setQuery] = useState('');
  const [filter,setFilter] = useState('pending');
  const [page,setPage] = useState(0);
  const [expanded,setExpanded] = useState<string[]>([]);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const boundary = useRef({ busy:false, unknown:false });
  useEffect(() => registerPaperBoundary(async () => {
    if (boundary.current.busy || boundary.current.unknown) throw new Error('主考点分类确认尚未完成，请先核对结果。');
  }),[]);
  const dirty = Object.keys(selection).length > 0 || busy || boundary.current.unknown;
  useEffect(() => { onDirty(dirty); },[dirty,onDirty]);
  if (!data) return null;
  const labels = { pending:'待确认建议',unclassified:'未分类',approved:'已确认',stale:'分类已过期' };
  const filtered = data.rows.filter(r => (filter === 'all' || r.state === filter) && `${r.item.source?.label ?? ''} ${r.item.modules.question.tex} ${r.item.topics.join(' ')}`.includes(query));
  const rows = filtered.slice(page*25,page*25+25);
  const groupFor = (id:string) => selection[id] ?? data.rows.find(r => r.item.id === id)?.proposal?.groupId ?? data.rows.find(r => r.item.id === id)?.approved?.groupId ?? '';
  const submit = async (reject:boolean) => {
    if (boundary.current.busy) return;
    const entries: TopicDecision[] = Object.keys(selection).map(itemId => {
      const row = data.rows.find(r => r.item.id === itemId)!;
      return { itemId,action: reject ? 'reject' : row.proposal && !row.proposalStale ? 'approve' : 'set',groupId: reject ? undefined : groupFor(itemId) };
    });
    if (!entries.length || entries.length > 500) { setError('请勾选 1 至 500 道题。'); return; }
    boundary.current.busy = true; setBusy(true);
    try {
      await paperRequest('topics-review',workspace,{ bankRevision:data.bankRevision,topicsRevision:data.revision,entries });
      setSelection({}); onDirty(false); setError(''); await refresh();
    } catch(e) {
      if (e instanceof ApiRequestError && e.code === 'WRITE_RESULT_UNKNOWN') boundary.current.unknown = true;
      setError(e instanceof Error ? e.message : '确认分类失败。');
    } finally { boundary.current.busy = false; setBusy(false); }
  };
  return <details className={styles.settings}><summary>主考点分类 · {data.rows.filter(r => r.state === 'pending').length} 条建议待确认</summary>
    <p>每题只按一个已确认主考点计入配额，原有考点标签保留。题面、题型、章节、考点或附件引用变化后需要重新确认。</p>
    {data.warning && <p role="alert">{data.warning}</p>}
    <div className={styles.actions}><label>分类状态<select value={filter} onChange={e => { setFilter(e.target.value); setPage(0); }}><option value="all">全部题目</option>{Object.entries(labels).map(([id,name]) => <option key={id} value={id}>{name}（{data.rows.filter(r => r.state === id).length}）</option>)}</select></label><label>查找题目<input value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} /></label><button className={controls.tertiaryAction} disabled={busy || !!data.warning} onClick={() => setSelection(s => ({ ...s,...Object.fromEntries(rows.filter(r => r.proposal && !r.proposalStale).map(r => [r.item.id,groupFor(r.item.id)])) }))}>勾选本页建议</button></div>
    <fieldset disabled={busy || !!data.warning} className={styles.topicList}><legend>题目主考点</legend>
      {!rows.length && <p>当前条件下没有题目。</p>}
      {rows.map(row => <article key={row.item.id} className={styles.topicRow}>
        <div className={styles.actions}><label><input type="checkbox" aria-label={`勾选分类 ${row.item.id}`} checked={Object.hasOwn(selection,row.item.id)} onChange={e => setSelection(s => { const next = { ...s }; if (e.target.checked) next[row.item.id] = groupFor(row.item.id); else delete next[row.item.id]; return next; })} />{row.item.source?.label || row.item.id}</label><span>{labels[row.state]}{row.proposalStale ? ' · 建议已过期' : ''}</span><label>主考点<select aria-label={`主考点 ${row.item.id}`} value={groupFor(row.item.id)} onChange={e => setSelection(s => ({ ...s,[row.item.id]:e.target.value }))}><option value="">请选择标准组</option>{topicGroups.map(g => <option value={g.id} key={g.id}>{g.id} · {g.name}</option>)}</select></label></div>
        <p>原有考点：{row.item.topics.join('、') || '未设置'} · 题型：{row.item.questionTypes.join('、') || '未分类'}</p>
        {row.proposal && <p>Agent 建议：{groupName(row.proposal.groupId)}。{row.proposal.reason}</p>}
        <details onToggle={e => { const open = e.currentTarget.open; setExpanded(ids => open ? [...new Set([...ids,row.item.id])] : ids.filter(id => id !== row.item.id)); }}><summary>查看完整题面</summary>{expanded.includes(row.item.id) && <LatexPreview compact tex={row.item.modules.question.tex} assets={row.item.assets} />}</details>
      </article>)}
    </fieldset>
    <div className={styles.actions}><button className={controls.tertiaryAction} disabled={page === 0} onClick={() => setPage(v => v-1)}>上一页</button><span>{filtered.length} 道 · 第 {page+1} 页 · 已勾选 {Object.keys(selection).length} 道</span><button className={controls.tertiaryAction} disabled={(page+1)*25 >= filtered.length} onClick={() => setPage(v => v+1)}>下一页</button></div>
    {error && <p role="alert">{error}</p>}
    <div className={styles.actions}><button className={controls.primaryAction} disabled={busy || !!data.warning || !Object.keys(selection).length} onClick={() => void submit(false)}>确认勾选分类</button><button className={controls.secondaryAction} disabled={busy || !!data.warning || !Object.keys(selection).length} onClick={() => void submit(true)}>拒绝勾选建议</button><button className={controls.tertiaryAction} disabled={busy} onClick={() => { void waitForPaperWrites().then(refresh).then(() => { boundary.current.unknown = false; setSelection({}); setError(''); onDirty(false); }).catch(e => setError(String(e))); }}>刷新并核对分类</button></div>
  </details>;
}
