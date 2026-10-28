import { useEffect, useRef, type MutableRefObject } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { StreamLanguage } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { EditorView } from "@codemirror/view";
import { bindWheelScroller } from "../utils/wheel.js";
import styles from "./ModuleEditor.module.css";

const latexExtension = StreamLanguage.define(stex);
const editorScrollPadding = EditorView.theme({
  ".cm-content": {
    paddingTop: "24px",
    paddingBottom: "72px"
  },
  ".cm-scroller": {
    overscrollBehavior: "contain"
  }
});

export default function LatexEditor({
  value,
  onChange,
  viewRef
}: {
  value: string;
  onChange: (value: string) => void;
  viewRef?: MutableRefObject<EditorView | null>;
}) {
  const editorPaneRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = editorPaneRef.current;
    if (!root) return undefined;
    return bindWheelScroller(root, () => root.querySelector<HTMLElement>(".cm-scroller"));
  }, []);

  useEffect(() => {
    if (!viewRef) return undefined;
    return () => {
      viewRef.current = null;
    };
  }, [viewRef]);

  return (
    <div className={styles.editorPane} ref={editorPaneRef}>
      <CodeMirror
        value={value}
        height="100%"
        basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: true }}
        extensions={[latexExtension, EditorView.lineWrapping, editorScrollPadding]}
        onChange={onChange}
        onCreateEditor={(view) => {
          if (viewRef) viewRef.current = view;
        }}
      />
    </div>
  );
}
