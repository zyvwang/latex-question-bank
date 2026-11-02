import { paperRequest } from '../api/client.js';
import type { CandidateRef, PaperOrigin } from '../../shared/variants.js';
import { configureQuota } from '../../shared/papers.js';
import { groupName, type TopicStamp } from '../../shared/paper-topics.js';
import { useEffect, useState } from 'react';
import { candidates, makeSlots, paperSections, sectionNames, slotProblems, subjectNames, type Paper, type PaperSlot } from '../../shared/papers.js';
import type { Bank } from '../../shared/types.js';
import { LatexPreview } from './LatexPreview.js';
import controls from '../styles/controls.module.css';
import styles from './PapersScreen.module.css';

const priorityOptions: [Paper['filters']['priorities'][number], string][] = [['must','必须复习'],['recheck','再复习'],['skip','可跳过'],['unset','未设置']];

export function PaperEditor({ paper, bank, edit, generate, applyRules, busy, groups = {}, applyTopics, workspace }: { workspace?: string; paper: Paper; bank: Bank; edit: (p: Paper) => void; generate: (index?: number, id?: string | CandidateRef) => void; applyRules: () => void; busy: boolean; groups?: Record<string,TopicStamp>; applyTopics?: () => void }) {
  const [manual,setManual] = useState<number | null>(null);
  const [query,setQuery] = useState('');
  const [remote,setRemote]=useState<(Bank['items'][number] & {origin:PaperOrigin})[]>([]);
  const [candidateError,setCandidateError]=useState('');
  const [availability,setAvailability]=useState<{section:string;subject:string;groupId:string;available:number}[]>([]);
  useEffect(() => {
    if ((manual === null && !paper.quota.enabled) || !workspace) return;
    let cancelled=false;setRemote([]);setCandidateError('');
    void paperRequest<{items:(Bank['items'][number] & {origin:PaperOrigin})[];report:{quotas:typeof availability}}>('candidates',workspace,{id:paper.id,index:manual ?? 0,paper}).then(r => {if (!cancelled) {setRemote(r.items);setAvailability(r.report.quotas);}}).catch(e => {if (!cancelled) setCandidateError(String(e));});
    return () => {cancelled=true;};
  },[manual,workspace,paper]);
  const pool=manual === null?[]:workspace?remote:candidates(bank,paper,manual,groups);
  const problems = slotProblems(paper);
  const conflictCount = bank.items.filter(q => new Set(q.questionTypes.map(t => paper.rules.types[t]).filter(Boolean)).size > 1).length;
  const patchSlot = (i: number, patch: Partial<PaperSlot>) => edit({ ...paper, slots: paper.slots.map((s,n) => n === i ? { ...s, ...patch } : s) });
  const multi = (key: 'chapters' | 'topics' | 'books', label: string, values: { id: string; name: string }[]) => <label>{label}<select multiple aria-label={label} value={paper.filters[key]} onChange={e => edit({ ...paper, filters: { ...paper.filters, [key]: Array.from(e.target.selectedOptions,o => o.value) } })}>{values.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>;
  return <div className={styles.editor}>
    <fieldset disabled={busy} className={styles.rules}><legend>试卷条件</legend>
      <div className={styles.fields}><label>标题<input value={paper.title} maxLength={100} onChange={e => edit({ ...paper, title: e.target.value })} /></label>
      <label>随机种子<input value={paper.seed} maxLength={100} onChange={e => edit(configureQuota({ ...paper, seed: e.target.value }))} /></label></div>
      <label><input type="checkbox" checked={paper.useVariants} onChange={e => edit({...paper,useVariants:e.target.checked})} />本卷启用已批准表达版本（工作区需开启版本管理，同族最多一道）</label>
      <div className={styles.priorities}><span>复习优先级 · 不选即不限</span>{priorityOptions.map(([id,label]) => <label key={id}><input type="checkbox" checked={paper.filters.priorities.includes(id)} onChange={e => edit({ ...paper, filters: { ...paper.filters, priorities: e.target.checked ? [...paper.filters.priorities,id] : paper.filters.priorities.filter(v => v !== id) } })} />{label}</label>)}</div>
      {paper.kind === 'practice' ? <details className={styles.scope}><summary>练习范围与题量 · {paper.filters.chapters.length + paper.filters.topics.length + paper.filters.books.length ? '已限定范围' : '不限范围'} · {paper.slots.length} 题</summary><div className={styles.fields}>
        {multi('chapters','章节范围',bank.chapters)}{multi('topics','考点范围',[...new Set(bank.items.flatMap(q => q.topics))].map(t => ({ id: t, name: t })))}{multi('books','书目范围',bank.books.map(b => ({ id: b.id, name: b.title })))}
      </div><p>范围均支持多选，清空表示不限。各范围之间同时满足。</p><button className={controls.tertiaryAction} onClick={() => edit({ ...paper, filters: { ...paper.filters,chapters: [],topics: [],books: [] } })}>清空范围</button><div className={styles.fields}>{paperSections.map(section => <label key={section}>{sectionNames[section]}题量<input type="number" min={0} max={100} value={paper.slots.filter(s => s.section === section).length} onChange={e => {
        const count = Number(e.target.value); if (!Number.isInteger(count) || count < 0 || count > 100) return;
        const slots = paperSections.flatMap((s,part) => {
          const existing = paper.slots.filter(v => v.section === s);
          if (s !== section) return existing;
          const fresh = makeSlots('practice', paperSections.map((_,n) => n === part ? count : 0));
          return Array.from({ length: count },(_,i) => existing[i] ?? fresh[i]);
        });
        if (!slots.length || slots.length > 200) return;
        if (count < paper.slots.filter(s => s.section === section).length && !window.confirm('减少题量将移除末尾题位，是否继续？')) return;
        edit({ ...paper, slots });
      }} /></label>)}</div></details> : <p>固定数一结构：22 题 · 150 分 · 180 分钟；高数 86、线代 32、概率 32 分。关闭考点配额时仅匹配题型与学科，不保证难度等同真题。</p>}
      {paper.kind === 'mock' && <div className={styles.quotaControls}><label><input type="checkbox" checked={paper.quota.enabled} onChange={e => edit(configureQuota({ ...paper,quota:{ ...paper.quota,enabled:e.target.checked } }))} />启用综合考点配额</label><p>{paper.quota.blueprintId.includes('2026') ? '2021—2026' : '2021—2025'} 综合蓝图，按题数约束，每题只计一个主考点；分区内按多年均值的上下取整区间分配，种子决定本卷配额，不保证难度等同真题。</p>{paper.quota.enabled && <button className={controls.secondaryAction} onClick={applyTopics}>应用最新主考点分类</button>}</div>}
      <div className={styles.actions}><button className={controls.secondaryAction} onClick={applyRules}>应用已保存映射</button><button className={controls.primaryAction} onClick={() => generate()}>重抽未锁定题目</button></div>
      {conflictCount > 0 && <p role="status">{conflictCount} 道题存在跨部分题型冲突，已排除，请到编辑页整理。</p>}
    </fieldset>
    <div className={styles.summary}><strong>{paper.slots.length} 题 · {paper.slots.reduce((v,s) => v+s.points,0)} 分</strong><span>{problems.filter(Boolean).length ? `${problems.filter(Boolean).length} 个题位待处理` : '题位齐全，可正式导出'}</span></div>
    {paper.quota.enabled && <div className={styles.quotaTable}><table><caption>本卷考点配额</caption><thead><tr><th>部分 / 学科 / 主考点</th><th>目标</th><th>已选</th><th>可用候选</th><th>缺口</th></tr></thead><tbody>{paper.slots.flatMap((slot,i) => {
      if (!slot.requiredGroup || paper.slots.slice(0,i).some(s => s.section === slot.section && s.subject === slot.subject && s.requiredGroup === slot.requiredGroup)) return [];
      const same = paper.slots.filter(s => s.section === slot.section && s.subject === slot.subject && s.requiredGroup === slot.requiredGroup);
      const selected = paper.slots.filter((s,n) => s.section === slot.section && s.subject === slot.subject && s.requiredGroup === slot.requiredGroup && s.snapshot && !problems[n]).length;
      const available = (workspace ? availability.find(r => r.section === slot.section && r.subject === slot.subject && r.groupId === slot.requiredGroup)?.available : undefined) ?? bank.items.filter(q => q.reviewStatus === 'approved' && groups[q.id]?.groupId === slot.requiredGroup && q.chapterId !== null && paper.rules.chapters[q.chapterId] === slot.subject && q.questionTypes.some(t => paper.rules.types[t] === slot.section) && new Set(q.questionTypes.map(t => paper.rules.types[t]).filter(Boolean)).size === 1 && (!paper.filters.priorities.length || paper.filters.priorities.includes(q.reviewPriority ?? 'unset'))).length;
      return [<tr key={i}><th>{sectionNames[slot.section]} / {slot.subject && subjectNames[slot.subject]} / {groupName(slot.requiredGroup)}</th><td>{same.length}</td><td>{selected}</td><td>{available}</td><td>{same.length-selected}</td></tr>];
    })}</tbody></table></div>}
    {paperSections.map(section => <section key={section} className={styles.part}><h2>{sectionNames[section]} <span>{paper.slots.filter(s => s.section === section).length} 题</span></h2>{paper.slots.map((slot,i) => slot.section !== section ? null : <article key={i} className={styles.slot}>
      <div className={styles.slotHeading}><strong>第 {i+1} 题 {slot.subject ? `· ${subjectNames[slot.subject]}` : ''}</strong>{slot.requiredGroup && <span>主考点：{groupName(slot.requiredGroup)}</span>}{problems[i] && <span className={styles.problem}>{problems[i]}</span>}<label>分值<input type="number" aria-label={`第${i+1}题分值`} disabled={busy || paper.kind === 'mock'} value={slot.points} min={1} max={150} onChange={e => patchSlot(i,{ points: Number(e.target.value) })} /></label><label><input type="checkbox" disabled={busy} checked={slot.locked} onChange={e => patchSlot(i,{ locked: e.target.checked })} />锁题</label></div>
      {slot.snapshot ? <LatexPreview assetBaseUrl="/api/papers/assets" compact tex={slot.snapshot.modules.question.tex} assets={slot.snapshot.assets} /> : <p className={styles.emptySlot}>缺题 · {sectionNames[section]}{slot.subject ? ` / ${subjectNames[slot.subject]}` : ''}。调整条件、补充题库或复制为练习卷后再抽题。</p>}
      {slot.snapshot && <details className={styles.solution}><summary>解析预览</summary><LatexPreview assetBaseUrl="/api/papers/assets" compact tex={slot.snapshot.modules.solution.tex.trim() || '本题暂无解析。'} assets={slot.snapshot.assets} /></details>}
      <div className={styles.slotFooter}><span>{slot.sourceText || '未记录来源'}{slot.origin?.ref.kind === 'variant' ? ' · 表达版本' : ''}{slot.snapshot ? ` · ${slot.snapshot.topics.join('、')}` : ''}</span><label>答题留白<select aria-label={`第${i+1}题留白`} disabled={busy} value={slot.space} onChange={e => patchSlot(i,{ space: e.target.value as PaperSlot['space'] })}><option value="compact">紧凑</option><option value="half">半页</option><option value="page">整页</option></select></label><button className={controls.tertiaryAction} disabled={busy || slot.locked} onClick={() => generate(i)}>换题</button><button className={controls.secondaryAction} disabled={busy || slot.locked} onClick={() => { setManual(manual === i ? null : i); setQuery(''); }}>手动选入</button></div>
      {manual === i && <div className={styles.picker}><label>搜索候选<input value={query} onChange={e => setQuery(e.target.value)} /></label>{candidateError && <p role="alert">{candidateError}</p>}{pool.filter(q => `${q.modules.question.tex} ${q.topics.join(' ')}`.includes(query)).map(q => <button disabled={busy} key={q.id} className={styles.candidate} onClick={() => { generate(i,'origin' in q ? (q.origin as PaperOrigin).ref : q.id); setManual(null); }}><span>{q.modules.question.tex.slice(0,200)}</span><small>{'origin' in q && (q.origin as PaperOrigin).ref.kind === 'variant' ? '表达版本 · ' : ''}{q.topics.join('、')}</small></button>)}{pool.length === 0 && <p>没有符合条件且尚未入卷的候选题。</p>}</div>}
    </article>)}</section>)}
  </div>;
}
