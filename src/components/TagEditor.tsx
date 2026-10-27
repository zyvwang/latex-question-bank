import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { mergeTags } from "../../shared/names.js";
import metadataStyles from "./MetadataTokens.module.css";
import styles from "./TagEditor.module.css";

// 考点、题型共用的多值编辑器；noun 用于无障碍文案（如「添加考点」「删除考点 极限」）。
interface TagEditorProps {
  tags: string[];
  suggestions: string[];
  onChange: (tags: string[]) => void;
  noun: string;
  listId: string;
  placeholder: string;
}

export function TagEditor({
  tags,
  suggestions,
  onChange,
  noun,
  listId,
  placeholder
}: TagEditorProps) {
  const [draft, setDraft] = useState("");

  useEffect(() => {
    setDraft("");
  }, [tags]);

  function commit(value = draft) {
    const next = mergeTags(tags, value.split(/[,，\n]/));
    if (next.length !== tags.length) onChange(next);
    setDraft("");
  }

  return (
    <div className={styles.editor}>
      <div className={styles.tags}>
        {tags.map((tag) => (
          <span
            className={`${metadataStyles.token} ${metadataStyles.tag} ${styles.tag}`}
            key={tag}
          >
            {tag}
            <button
              type="button"
              aria-label={`删除${noun} ${tag}`}
              onClick={() => onChange(tags.filter((candidate) => candidate !== tag))}
            >
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
      <input
        aria-label={`添加${noun}`}
        list={listId}
        value={draft}
        onChange={(event) => {
          const value = event.target.value;
          if (/[,，\n]/.test(value)) commit(value);
          else setDraft(value);
        }}
        onBlur={() => commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Backspace" && !draft && tags.length) {
            onChange(tags.slice(0, -1));
          }
        }}
        placeholder={tags.length ? "继续添加" : placeholder}
      />
      <datalist id={listId}>
        {suggestions
          .filter((suggestion) => !tags.includes(suggestion))
          .map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
      </datalist>
    </div>
  );
}
