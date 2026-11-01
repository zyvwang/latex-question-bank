import styles from "./Sidebar.module.css";

interface FilterOption {
  value: string;
  label: string;
  color?: string;
}

export function MultiSelectFilter({
  icon,
  label,
  allLabel,
  selected,
  onChange,
  options
}: {
  icon: React.ReactNode;
  label: string;
  allLabel: string;
  selected: string[];
  onChange: (value: string[]) => void;
  options: FilterOption[];
}) {
  return (
    <details className={styles.filterMenu}>
      <summary aria-label={`${label}筛选，已选 ${selected.length} 项`}>
        {icon}
        <span>{selected.length ? `${label} ${selected.length}` : allLabel}</span>
      </summary>
      <div className={styles.filterOptions}>
        <div className={styles.filterOptionsHeader}>
          <strong>{label}</strong>
          <button
            onClick={() => onChange([])}
            disabled={selected.length === 0}
          >
            清除
          </button>
        </div>
        {options.length ? (
          options.map((option) => (
            <label key={option.value}>
              <input
                type="checkbox"
                checked={selected.includes(option.value)}
                onChange={() =>
                  onChange(
                    selected.includes(option.value)
                      ? selected.filter((value) => value !== option.value)
                      : [...selected, option.value]
                  )
                }
              />
              {option.color ? (
                <i style={{ backgroundColor: option.color }} aria-hidden="true" />
              ) : null}
              <span>{option.label}</span>
            </label>
          ))
        ) : (
          <p>暂无可用选项</p>
        )}
      </div>
    </details>
  );
}

