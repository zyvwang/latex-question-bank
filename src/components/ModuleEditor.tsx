import {
  lazy,
  Suspense,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties
} from "react";
import { ImagePlus } from "lucide-react";
import { moduleLabels } from "../constants.js";
import { SOLUTION_SOURCE_LABELS } from "../../shared/review-fields.js";
import type {
  ModuleKind,
  QuestionItem,
  SolutionSource
} from "../../shared/types.js";
import { UI_LAYOUT_LIMITS } from "../../shared/ui-layout-preferences.js";
import { useLayoutPreferences } from "../context/layoutPreferences.js";
import { useQuestions } from "../context/questionBankContexts.js";
import { LatexPreview } from "./LatexPreview.js";
import { PaneResizeHandle } from "./PaneResizeHandle.js";
import controls from "../styles/controls.module.css";
import styles from "./ModuleEditor.module.css";

const LatexEditor = lazy(() => import("./LatexEditor.js"));

interface ModuleEditorProps {
  kind: ModuleKind;
  value: string;
  item: QuestionItem;
  onChange: (value: string) => void;
  onUpload: (file: File) => Promise<void>;
}

export function ModuleEditor({ kind, value, item, onChange, onUpload }: ModuleEditorProps) {
  const questions = useQuestions();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const { preferences, updatePreferences } = useLayoutPreferences();

  async function handleFile(file?: File) {
    if (!file) return;
    setIsUploading(true);
    try {
      await onUpload(file);
    } finally {
      setIsUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function handleChange(nextValue: string) {
    onChange(nextValue);
    if (
      kind === "solution" &&
      item.solutionSource === "none" &&
      nextValue.trim()
    ) {
      questions.updateItem(item.id, { solutionSource: "user" });
    }
  }

  return (
    <article
      className={styles.modulePanel}
      id={`module-panel-${kind}`}
      role="tabpanel"
      aria-labelledby={`module-tab-${kind}`}
    >
      <div className={styles.panelHead}>
        <header>
          <div>
            <span>当前模块</span>
            <h2>{moduleLabels[kind]}</h2>
          </div>
          <button
            className={controls.iconButton}
            onClick={() => fileInput.current?.click()}
            aria-label="插入图片"
            title="插入图片"
          >
            <ImagePlus size={17} />
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg"
            hidden
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
          {isUploading && <span className={styles.miniStatus}>上传中</span>}
        </header>
        {kind === "solution" && <SolutionMetaFields item={item} />}
      </div>
      <div
        className={styles.moduleGrid}
        ref={gridRef}
        style={{
          "--module-editor-percent": `${preferences.moduleEditorPercent}%`
        } as CSSProperties}
      >
        <div className={styles.editorRegion} id={`module-editor-${kind}`}>
          <Suspense fallback={<div className={`${styles.editorPane} ${styles.editorFallback}`}>编辑器加载中</div>}>
            <LatexEditor value={value} onChange={handleChange} />
          </Suspense>
        </div>
        <PaneResizeHandle
          value={preferences.moduleEditorPercent}
          min={UI_LAYOUT_LIMITS.moduleEditorPercent.min}
          max={UI_LAYOUT_LIMITS.moduleEditorPercent.max}
          step={2}
          pixelsPerUnit={() => (gridRef.current?.clientWidth ?? 100) / 100}
          label="调整代码与预览比例"
          controls={`module-editor-${kind} module-preview-${kind}`}
          valueText={(value) => `代码 ${Math.round(value)}%，预览 ${100 - Math.round(value)}%`}
          onPreview={(value) =>
            gridRef.current?.style.setProperty("--module-editor-percent", `${value}%`)
          }
          onCommit={(moduleEditorPercent) =>
            updatePreferences({ moduleEditorPercent })
          }
        />
        <div className={styles.previewRegion} id={`module-preview-${kind}`}>
          <LatexPreview tex={value} assets={item.assets} />
        </div>
      </div>
    </article>
  );
}

function SolutionMetaFields({ item }: { item: QuestionItem }) {
  const questions = useQuestions();
  const [reference, setReference] = useState(item.solutionRef ?? "");

  useLayoutEffect(() => {
    setReference(item.solutionRef ?? "");
  }, [item.id, item.solutionRef]);

  function commitReference() {
    const value = reference.trim();
    questions.updateItem(item.id, { solutionRef: value || null });
  }

  return (
    <div className={styles.solutionMeta}>
      <label>
        <span>答案来源</span>
        <select
          aria-label="答案来源"
          value={item.solutionSource ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            questions.updateItem(item.id, {
              solutionSource: value ? (value as SolutionSource) : null
            });
          }}
        >
          <option value="">来源未记录</option>
          {(Object.entries(SOLUTION_SOURCE_LABELS) as Array<
            [SolutionSource, string]
          >).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>参考</span>
        <input
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          onBlur={commitReference}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          placeholder="页码 / 答案编号"
          aria-label="答案参考"
        />
      </label>
    </div>
  );
}
