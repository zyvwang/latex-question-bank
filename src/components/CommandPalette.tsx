import { useEffect, useMemo, useState } from "react";
import { questionSourceDisplay } from "../../shared/question-source.js";
import { reviewPriorityLabel } from "../../shared/review-fields.js";
import { useAppView, useBankSettings, useQuestions } from "../context/questionBankContexts.js";
import { useLayoutPreferences } from "../context/layoutPreferences.js";
import { useSkins } from "../context/skins.js";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import styles from "./CommandPalette.module.css";

interface Command {
  id: string;
  name: string;
  hint: string;
  run: () => void;
}

const MAX_RESULTS = 9;

function isOpenShortcut(event: KeyboardEvent): boolean {
  // macOS 上 Ctrl+K 是编辑器的删到行尾，不能占用。
  const mac = navigator.platform.toLowerCase().includes("mac");
  return event.key.toLowerCase() === "k" && (mac ? event.metaKey : event.ctrlKey);
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isOpenShortcut(event)) return;
      event.preventDefault();
      setOpen((current) => !current);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return open ? <PaletteDialog onClose={() => setOpen(false)} /> : null;
}

function PaletteDialog({ onClose }: { onClose: () => void }) {
  const appView = useAppView();
  const questions = useQuestions();
  const { books } = useBankSettings();
  const { skins, chooseSkin } = useSkins();
  const { updatePreferences } = useLayoutPreferences();
  const dialogRef = useFocusTrap<HTMLDivElement>();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  const commands = useMemo<Command[]>(() => [
    { id: "editor", name: "打开编辑页", hint: "页面", run: () => appView.setActiveView("editor") },
    { id: "review", name: "打开待审阅", hint: "页面", run: () => appView.setActiveView("review") },
    { id: "distribution", name: "打开复习分布", hint: "页面", run: () => appView.setActiveView("distribution") },
    { id: "papers", name: "打开组卷", hint: "页面", run: () => appView.setActiveView("papers") },
    { id: "settings", name: "打开题库设置", hint: "页面", run: () => appView.setActiveView("settings") },
    ...skins.map((skin) => ({
      id: `skin-${skin.id}`,
      name: `切换到${skin.name}皮肤`,
      hint: "皮肤",
      run: () => {
        chooseSkin(skin);
        updatePreferences({ skinMode: skin.mode });
      }
    })),
    ...questions.orderedItems.map((item) => ({
      id: `question-${item.id}`,
      name: `${questionSourceDisplay(item, books)} ${item.topics.join(" ")}`.trim(),
      hint: reviewPriorityLabel(item.reviewPriority),
      run: () => appView.openQuestionFromDistribution(item.id)
    }))
  ], [appView, books, chooseSkin, questions.orderedItems, skins, updatePreferences]);

  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    const matched = term
      ? commands.filter((command) => `${command.name} ${command.hint}`.toLowerCase().includes(term))
      : commands;
    return matched.slice(0, MAX_RESULTS);
  }, [commands, query]);

  function run(command: Command | undefined) {
    if (!command) return;
    onClose();
    command.run();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && results.length) {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setIndex((index + step + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      run(results[index]);
    }
  }

  return (
    <div className={styles.scrim} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        className={styles.palette}
        role="dialog"
        aria-modal="true"
        aria-label="命令面板"
        onKeyDown={onKeyDown}
      >
        <input
          data-autofocus
          aria-label="搜索题目或命令"
          placeholder="搜索题目或命令"
          autoComplete="off"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setIndex(0);
          }}
        />
        {results.length ? (
          <ul>
            {results.map((command, position) => (
              <li key={command.id} data-active={position === index || undefined}>
                <button type="button" tabIndex={-1} onClick={() => run(command)}>
                  {command.name}
                  <small>{command.hint}</small>
                </button>
              </li>
            ))}
          </ul>
        ) : <p>没有匹配的题目或命令。</p>}
      </div>
    </div>
  );
}
