import { act, render, renderHook, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { EditorView } from "@codemirror/view";
import { redo, undo, undoDepth } from "@codemirror/commands";
import type { ModuleKind } from "../../shared/types.js";
import { bank } from "../fixtures/app-ui.js";

// 撤销历史边界的回归测试：用户反馈“粘贴替换全部后 ⌘Z 变成了不对的内容”，
// 根因是同一个 CodeMirror 实例被不同题目、模块复用，外部整体替换进入了撤销历史。

const mocks = vi.hoisted(() => ({
  questions: { snapshotEpoch: 0, updateItem: vi.fn() },
  mounts: 0
}));

vi.mock("../../src/context/skins.js", () => ({
  useSkins: () => ({ activeSkin: { mode: "light" } })
}));

// jsdom 没有排版：补上 CodeMirror 测量光标位置要用的接口，避免无关报错
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}

describe("真实 CodeMirror 的撤销历史边界", () => {
  // 延迟加载，避免下方对 LatexEditor 的 mock 影响这里
  async function realEditor() {
    return (await vi.importActual<typeof import("../../src/components/LatexEditor.js")>(
      "../../src/components/LatexEditor.js"
    )).default;
  }

  async function setup() {
    const LatexEditor = await realEditor();
    const changes: string[] = [];
    let viewRef: { current: EditorView | null } = { current: null };
    function Harness({ editorKey, value }: { editorKey: string; value: string }) {
      const ref = useRef<EditorView | null>(null);
      viewRef = ref;
      return (
        <LatexEditor key={editorKey} value={value} onChange={(next) => changes.push(next)} viewRef={ref} />
      );
    }
    const view = () => {
      if (!viewRef.current) throw new Error("编辑器尚未创建");
      return viewRef.current;
    };
    const command = (fn: typeof undo) =>
      act(() => fn({ state: view().state, dispatch: (tr) => view().dispatch(tr) }));
    const pasteAll = (text: string) =>
      act(() => {
        view().dispatch({
          changes: { from: 0, to: view().state.doc.length, insert: text },
          userEvent: "input.paste"
        });
      });
    // 超过 CodeMirror 合并相邻编辑的 500ms，以及 react-codemirror 的输入暂缓 200ms
    const waitPastGrouping = () => act(() => new Promise((resolve) => setTimeout(resolve, 600)));
    return { Harness, view, command, pasteAll, waitPastGrouping, changes };
  }

  it("对照：同一实例被另一道题复用时，第二次撤销会把上一题的内容写回来（修复前的行为）", async () => {
    const { Harness, view, command, pasteAll, changes } = await setup();
    const { rerender } = render(<Harness editorKey="same" value="第一题" />);
    await act(async () => {});
    rerender(<Harness editorKey="same" value="第二题" />);
    await act(async () => {});
    pasteAll("粘贴的新内容");
    command(undo);
    expect(view().state.doc.toString()).toBe("第二题");
    command(undo);
    expect(view().state.doc.toString()).toBe("第一题");
    expect(changes).toContain("第一题");
  });

  it("换题后重建编辑器：撤销只回到本题原文，不会写入上一题的内容", async () => {
    const { Harness, view, command, pasteAll, changes } = await setup();
    const { rerender } = render(<Harness editorKey="0:a:question" value="第一题" />);
    await act(async () => {});
    rerender(<Harness editorKey="0:b:question" value="第二题" />);
    await act(async () => {});
    expect(undoDepth(view().state)).toBe(0);
    pasteAll("粘贴的新内容");
    command(undo);
    expect(view().state.doc.toString()).toBe("第二题");
    command(undo);
    expect(view().state.doc.toString()).toBe("第二题");
    expect(changes).not.toContain("第一题");
  });

  it("两处文本相同（都是空串）时也隔离，重做不会把上一处的草稿带过来", async () => {
    const { Harness, view, command, pasteAll, changes } = await setup();
    const { rerender } = render(<Harness editorKey="0:a:solution" value="" />);
    await act(async () => {});
    pasteAll("草稿");
    command(undo);
    expect(view().state.doc.toString()).toBe("");
    rerender(<Harness editorKey="0:a:note" value="" />);
    await act(async () => {});
    command(redo);
    expect(view().state.doc.toString()).toBe("");
    expect(changes.filter((value) => value === "草稿")).toHaveLength(1);
  });

  it("同一模块内插入图片（外部追加）后仍可撤销，并保留更早的编辑历史", async () => {
    const { Harness, view, command, pasteAll, waitPastGrouping } = await setup();
    const { rerender } = render(<Harness editorKey="0:a:question" value="原文" />);
    await act(async () => {});
    pasteAll("粘贴后");
    // 已知限制（原有行为，未在本次修复）：图片引用若在粘贴后 500ms 内到达，
    // react-codemirror 的整体替换会和粘贴合并成一步撤销。这里等过合并窗口。
    await waitPastGrouping();
    rerender(<Harness editorKey="0:a:question" value={"粘贴后\n\\qimg{a.png}"} />);
    await waitPastGrouping();
    expect(view().state.doc.toString()).toBe("粘贴后\n\\qimg{a.png}");
    command(undo);
    expect(view().state.doc.toString()).toBe("粘贴后");
    command(undo);
    expect(view().state.doc.toString()).toBe("原文");
  });
});

vi.mock("../../src/components/LatexEditor.js", async () => {
  const { useState: useStateInMock } = await import("react");
  return {
    default: function FakeLatexEditor({ value }: { value: string }) {
      const [instance] = useStateInMock(() => ++mocks.mounts);
      return <textarea aria-label="编辑器" data-instance={instance} value={value} readOnly />;
    }
  };
});
vi.mock("../../src/context/questionBankContexts.js", () => ({
  useQuestions: () => mocks.questions
}));
vi.mock("../../src/context/layoutPreferences.js", () => ({
  useLayoutPreferences: () => ({ preferences: { moduleEditorPercent: 50 }, updatePreferences: vi.fn() })
}));
vi.mock("../../src/components/LatexPreview.js", () => ({ LatexPreview: () => null }));

describe("ModuleEditor 按 快照代次 + 题目 + 模块 重建编辑器", () => {
  it("只有身份变化才重建；同一模块内的内容变化不重建", async () => {
    const { ModuleEditor } = await import("../../src/components/ModuleEditor.js");
    const [first, second] = bank.items;
    function Host({ kind, itemIndex, value, epoch }: { kind: ModuleKind; itemIndex: number; value: string; epoch: number }) {
      mocks.questions.snapshotEpoch = epoch;
      const item = itemIndex === 0 ? first : second;
      return <ModuleEditor kind={kind} value={value} item={item} onChange={() => {}} onUpload={async () => {}} />;
    }
    const instance = () => screen.getByLabelText("编辑器").getAttribute("data-instance");
    const { rerender } = render(<Host kind="question" itemIndex={0} value="原文" epoch={0} />);
    await screen.findByLabelText("编辑器");
    const initial = instance();

    rerender(<Host kind="question" itemIndex={0} value="改过的内容" epoch={0} />);
    expect(instance()).toBe(initial);

    rerender(<Host kind="solution" itemIndex={0} value="改过的内容" epoch={0} />);
    const afterModule = instance();
    expect(afterModule).not.toBe(initial);

    rerender(<Host kind="solution" itemIndex={1} value="改过的内容" epoch={0} />);
    const afterItem = instance();
    expect(afterItem).not.toBe(afterModule);

    rerender(<Host kind="solution" itemIndex={1} value="改过的内容" epoch={1} />);
    expect(instance()).not.toBe(afterItem);
  });
});

describe("useAutosave 的快照代次", () => {
  it("每次整库替换都加一", async () => {
    const { useAutosave } = await import("../../src/hooks/useAutosave.js");
    const { result } = renderHook(() => {
      const [currentBank] = useState(bank);
      return useAutosave(currentBank, vi.fn());
    });
    const before = result.current.snapshotEpoch;
    act(() => result.current.resetAutosave({ bank, revision: "r1", workspacePath: "/bank" }));
    act(() => result.current.resetAutosave(null));
    expect(result.current.snapshotEpoch).toBe(before + 2);
  });
});
