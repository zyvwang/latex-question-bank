import { usePaperSettingsDraft } from '../hooks/usePaperSettingsDraft.js';
import { defaultPaperSettings, paperSections, sectionNames, subjectNames, type PaperSection, type PaperSettings, type Subject } from '../../shared/papers.js';
import type { Bank } from '../../shared/types.js';
import controls from '../styles/controls.module.css';
import styles from './PapersScreen.module.css';

export function PaperSettingsEditor({ bank, workspace, initial, onSaved }: { bank: Bank; workspace: string; initial: { settings: PaperSettings; revision: string }; onSaved: (v: { settings: PaperSettings; revision: string }) => void }) {
  const { value, setValue, error, saving: busy, flush, retry, setError } = usePaperSettingsDraft(workspace,initial,onSaved);
  const types = [...new Set([...Object.keys(defaultPaperSettings().types), ...Object.keys(value.types), ...bank.items.flatMap(q => q.questionTypes)])];
  return <details className={styles.settings}><summary>组卷设置 · 学科与题型映射</summary>
    <p>章节须明确映射。未映射章节及未分类题不会进入模拟卷；跨部分题型冲突的题目排除。设置只作为新卷默认值，旧卷可主动应用。</p>
    <div className={styles.mapping}>
      <fieldset><legend>章节 → 学科</legend>{bank.chapters.map(ch => <label key={ch.id}>{ch.name}<select aria-label={`${ch.name}学科`} value={value.chapters[ch.id] ?? ''} onChange={e => {
        const chapters = { ...value.chapters }; if (e.target.value) chapters[ch.id] = e.target.value as Subject; else delete chapters[ch.id]; setValue({ ...value, chapters });
      }}><option value="">未映射</option>{Object.entries(subjectNames).map(([id,name]) => <option key={id} value={id}>{name}</option>)}</select></label>)}</fieldset>
      <fieldset><legend>题型 → 部分</legend>{types.map(t => <label key={t}>{t}<select aria-label={`${t}归类`} value={value.types[t] ?? ''} onChange={e => {
        const types = { ...value.types }; if (e.target.value) types[t] = e.target.value as PaperSection; else delete types[t]; setValue({ ...value, types });
      }}><option value="">未归类</option>{paperSections.map(s => <option key={s} value={s}>{sectionNames[s]}</option>)}</select></label>)}</fieldset>
    </div>
    {error && <p role="alert">{error}</p>}
    <button className={controls.secondaryAction} disabled={busy} onClick={() => {
      void (error ? retry() : flush()).catch(e => setError(String(e)));
    }}>{busy ? '映射保存中' : error ? '核对并重试映射' : '保存映射'}</button>
  </details>;
}
