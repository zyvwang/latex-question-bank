import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { mergeTags } from "../../shared/names.js";
import metadataStyles from "./MetadataTokens.module.css";
import styles from "./TagEditor.module.css";

interface TagEditorProps {
  tags: string[];
  suggestions: string[];
  onChange: (tags: string[]) => void;
  // 维度编辑器：显示时去掉前缀，输入时自动补上前缀；suggestions 也不带前缀。
  prefix?: string;
  inputLabel?: string;
  listId?: string;
}

export function TagEditor({
  tags,
  suggestions,
  onChange,
  prefix = "",
  inputLabel = "添加标签",
  listId = "workspace-tag-suggestions"
}: TagEditorProps) {
  const [draft, setDraft] = useState("");
  const shown = (tag: string) => (prefix && tag.startsWith(prefix) ? tag.slice(prefix.length) : tag);
  const withPrefix = (value: string) => {
    const text = value.trim();
    return !prefix || !text || text.startsWith(prefix) ? text : `${prefix}${text}`;
  };

  useEffect(() => {
    setDraft("");
  }, [tags]);

  function commit(value = draft) {
    const next = mergeTags(tags, value.split(/[,，\n]/).map(withPrefix));
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
            {shown(tag)}
            <button
              type="button"
              aria-label={`删除标签 ${tag}`}
              onClick={() => onChange(tags.filter((candidate) => candidate !== tag))}
            >
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
      <input
        aria-label={inputLabel}
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
        placeholder={prefix ? "添加" : tags.length ? "继续添加" : "极限, 洛必达"}
      />
      <datalist id={listId}>
        {suggestions
          .filter((suggestion) => !tags.some((tag) => shown(tag) === suggestion))
          .map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
      </datalist>
    </div>
  );
}
