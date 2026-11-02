import { useEffect, useRef, useState } from "react";
import { ChevronRight, Check, X, PencilLine } from "lucide-react";
import { questionSourceDisplay } from "../../shared/question-source.js";
import { kindNames, type FamilyView, type VariantQueue, type VariantRow } from "../../shared/variants.js";
import { ApiRequestError, fetchBank, variantRequest, waitForPaperWrites } from "../api/client.js";
import { useAppView, useLifecycle, useQuestions } from "../context/questionBankContexts.js";
import { registerPaperBoundary } from "../utils/pendingPaperChanges.js";
import { LatexPreview } from "./LatexPreview.js";
import controls from "../styles/controls.module.css";
import styles from "./VariantReviewQueue.module.css";

const variantAssets = "/api/variants/assets";

export function VariantReviewQueue({ workspace, queue, reload, pause }: {
  workspace: string;
  queue: VariantQueue;
  reload: () => Promise<VariantQueue>;
  pause: (paused: boolean) => void;
}) {
  const { bank, updateItem } = useQuestions();
  const lifecycle = useLifecycle();
  const appView = useAppView();
  const [currentId, setCurrentId] = useState<string | null>(queue.families[0]?.family.id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [unknown, setUnknown] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const boundary = useRef({ busy: false, unknown: false });
  const flight = useRef(false);
  const detail = useRef<HTMLDivElement | null>(null);

  useEffect(() => registerPaperBoundary(async () => {
    if (boundary.current.busy || boundary.current.unknown) throw new Error("版本审阅尚未完成，请先读取磁盘并核对结果。");
  }), []);

  const families = queue.families;
  const index = families.findIndex((f) => f.family.id === currentId);
  const current = families[index] ?? families[0] ?? null;

  const show = (family: FamilyView | undefined) => {
    setCurrentId(family?.family.id ?? null);
    setConfirmed(false);
    if (detail.current) detail.current.scrollTop = 0;
  };

  if (!current) {
    return (
      <section className={styles.empty} id="main-workspace" aria-label="版本审阅">
        <h1>没有待审阅版本</h1>
        <p>Agent 录入或修订的版本会出现在这里。</p>
        <button type="button" className={controls.secondaryAction} onClick={() => appView.setReviewTab("originals")}>回到原题</button>
      </section>
    );
  }

  const root = bank?.items.find((item) => item.id === current.family.rootId) ?? current.root;
  const rootApproved = root?.reviewStatus === "approved";
  const needsBasis = current.rows.some((row) => row.state === "待复核");
  const canDecide = rootApproved && !busy && !unknown;

  const decide = async (rows: VariantRow[], action: "approve" | "reject") => {
    if (flight.current || boundary.current.unknown) return;
    flight.current = true; setBusy(true); pause(true);
    const position = index < 0 ? 0 : index;
    try {
      // Flushing runs the paper boundaries, including ours: only hold it once the flush is done.
      await lifecycle.flushPendingChanges();
      boundary.current.busy = true;
      const snapshot = await fetchBank();
      await variantRequest("review", workspace, {
        familyId: current.family.id, revision: current.revision, bankRevision: snapshot.revision, rootFingerprint: current.rootFingerprint,
        entries: rows.map((row) => ({ variantId: row.entry.id, versionRevision: row.revision.id, action, confirmCurrentBasis: confirmed }))
      });
      const next = await reload();
      setError("");
      if (!next.families.some((f) => f.family.id === current.family.id)) show(next.families[Math.min(position, next.families.length - 1)]);
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === "WRITE_RESULT_UNKNOWN") { boundary.current.unknown = true; setUnknown(true); }
      setError(e instanceof Error ? e.message : "审阅失败，请核对后重试。");
    } finally {
      flight.current = false; boundary.current.busy = false; setBusy(false); pause(false);
    }
  };

  const verify = () => void waitForPaperWrites().then(reload).then(() => {
    boundary.current.unknown = false; setUnknown(false); setError("");
  }).catch((e: unknown) => setError(e instanceof Error ? e.message : "核对失败。"));

  const skip = () => show(families[(families.indexOf(current) + 1) % families.length]);

  return (
    <section className={styles.queue} id="main-workspace" aria-label="版本审阅">
      <aside className={styles.rail} aria-label="待审原题">
        <header><strong>{queue.total} 个版本</strong><span>{families.length} 道原题</span></header>
        <ol>
          {families.map((family) => {
            const item = bank?.items.find((q) => q.id === family.family.rootId) ?? family.root;
            return (
              <li key={family.family.id}>
                <button type="button" aria-current={family === current ? "true" : undefined} onClick={() => show(family)}>
                  <span>{item ? questionSourceDisplay(item, bank?.books ?? []) : family.family.rootId}</span>
                  <small>
                    {family.rows.map((row) => kindNames[row.revision.content.targetKind]).join("、")}
                    {item?.reviewStatus !== "approved" && " · 原题待审阅"}
                  </small>
                </button>
              </li>
            );
          })}
        </ol>
      </aside>
      <div className={styles.detail} ref={detail}>
        {queue.warnings.map((warning) => <p key={warning} role="alert" className={styles.alert}>{warning}</p>)}
        <section aria-label="原题">
          <div className={styles.heading}>
            <h1>{root ? questionSourceDisplay(root, bank?.books ?? []) : "原题"}</h1>
            <span>原题 · {kindNames[current.family.originalKind]}</span>
          </div>
          {!rootApproved && (
            <div className={styles.rootPending}>
              <p>原题还在待审阅，批准后才能审阅它的版本。</p>
              <button type="button" className={controls.secondaryAction} disabled={!root || busy} onClick={() => root && updateItem(root.id, { reviewStatus: "approved" })}>批准原题</button>
            </div>
          )}
          <LatexPreview compact tex={root?.modules.question.tex ?? ""} assets={root?.assets ?? []} />
          <details className={styles.more}>
            <summary>原题解析</summary>
            <LatexPreview compact tex={root?.modules.solution.tex.trim() || "暂无解析"} assets={root?.assets ?? []} />
          </details>
        </section>
        {current.rows.map((row) => (
          <article key={row.entry.id} className={styles.version} aria-label={`${kindNames[row.revision.content.targetKind]}版本`}>
            <div className={styles.heading}>
              <h2>{kindNames[row.revision.content.targetKind]}版本</h2>
              <span>{row.state}</span>
            </div>
            <LatexPreview compact assetBaseUrl={variantAssets} tex={row.revision.content.question} assets={row.revision.item.assets} />
            <div className={styles.answer}>
              <span>答案</span>
              <LatexPreview compact tex={row.revision.content.answer} assets={[]} />
            </div>
            <details className={styles.more}>
              <summary>版本解析</summary>
              <LatexPreview compact assetBaseUrl={variantAssets} tex={row.revision.content.solution} assets={row.revision.item.assets} />
            </details>
            {row.state === "待复核" && (
              <details className={styles.more}>
                <summary>生成时的原题</summary>
                <LatexPreview compact assetBaseUrl={variantAssets} tex={row.revision.base.modules.question.tex} assets={row.revision.base.assets} />
              </details>
            )}
            <div className={styles.rowActions}>
              <button type="button" className={controls.secondaryAction} disabled={!canDecide || (row.state === "待复核" && !confirmed)} onClick={() => void decide([row], "approve")}><Check size={16} />批准</button>
              <button type="button" className={controls.secondaryAction} disabled={!canDecide} onClick={() => { if (window.confirm("拒绝这个版本？之后不会再出现在队列中。")) void decide([row], "reject"); }}><X size={16} />拒绝</button>
              <button type="button" className={controls.tertiaryAction} disabled={busy} onClick={() => appView.focusVariantFamily(current.family.id)}><PencilLine size={16} />修订</button>
            </div>
          </article>
        ))}
        <footer className={styles.footer}>
          {error && <div role="alert" className={styles.alert}><p>{error}</p>{unknown && <button type="button" className={controls.secondaryAction} onClick={verify}>读取磁盘并核对结果</button>}</div>}
          {needsBasis && <label><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />原题已变化。我已对照当前原题，确认保留全部条件、数值与目标</label>}
          <div className={styles.footerActions}>
            <span>第 {families.indexOf(current) + 1} / {families.length} 道</span>
            <button type="button" className={controls.secondaryAction} disabled={busy || families.length < 2} onClick={skip}><ChevronRight size={16} />跳过</button>
            <button type="button" className={controls.primaryAction} disabled={!canDecide || (needsBasis && !confirmed)} onClick={() => void decide(current.rows, "approve")}><Check size={16} />{busy ? "处理中…" : current.rows.length > 1 ? `批准全部 ${current.rows.length} 个并下一题` : "批准并下一题"}</button>
          </div>
        </footer>
      </div>
    </section>
  );
}
