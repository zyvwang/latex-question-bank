import { act, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { redo, undo, undoDepth } from "@codemirror/commands";
import type { Bank } from "../../shared/types.js";
import App from "../../src/App.js";
import { bank, handleFetch, setFixtureBank, setupAppFixture } from "../fixtures/app-ui.js";

// 用真实 App 和真实 CodeMirror（不 mock LatexEditor）验证撤销历史的边界，
// 并检查最终 PUT 给服务端的内容。对应用户反馈：撤销后“变成了不对的内容”。

setupAppFixture();

// jsdom 没有排版：补上 CodeMirror 测量光标位置要用的接口
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  private listeners = new Map<string, Set<EventListener>>();
  constructor(public readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const callback = typeof listener === "function" ? listener : (event: Event) => listener.handleEvent(event);
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(callback);
    this.listeners.set(type, listeners);
  }
  removeEventListener() {}
  close(): void {}
  emit(type: string, data: unknown): void {
    const event = new MessageEvent(type, { data: JSON.stringify(data) });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

afterEach(() => {
  FakeEventSource.instances = [];
  vi.unstubAllGlobals();
});

const IMPORT_EVENT = {
  workspacePath: "/tmp/latex-bank",
  revision: "revision-import",
  counts: { created: 0, updated: 1, skipped: 0, conflicts: 0, assets: 0 }
};

function currentView(): EditorView {
  const root = document.querySelector<HTMLElement>(".cm-editor");
  const view = root ? EditorView.findFromDOM(root) : null;
  if (!view) throw new Error("编辑器尚未创建");
  return view;
}

async function editorShows(text: string) {
  await waitFor(() => expect(currentView().state.doc.toString()).toBe(text));
}

function pasteAll(text: string) {
  act(() => {
    const view = currentView();
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, userEvent: "input.paste" });
  });
}

function run(command: typeof undo) {
  let applied = false;
  act(() => {
    applied = command(currentView());
  });
  return applied;
}

function savedBanks(): { workspacePath: string; bank: Bank }[] {
  return vi.mocked(fetch).mock.calls
    .filter(([url, init]) => String(url) === "/api/bank" && init?.method === "PUT")
    .map(([, init]) => JSON.parse(String(init?.body)) as { workspacePath: string; bank: Bank });
}

function questionTex(saved: { bank: Bank }, id: string) {
  return saved.bank.items.find((item) => item.id === id)?.modules.question.tex;
}

async function waitForSaves(count: number) {
  await waitFor(() => expect(savedBanks().length).toBeGreaterThanOrEqual(count), { timeout: 3000 });
  await act(async () => {});
}

function withQuestion(id: string, tex: string): Bank {
  return {
    ...bank,
    items: bank.items.map((item) =>
      item.id === id ? { ...item, modules: { ...item.modules, question: { tex } } } : item
    )
  };
}

async function startApp() {
  vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText("2024-1");
  await editorShows("求极限 $x$。");
  await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
  return user;
}

it("换题后粘贴再连续撤销：只回到本题原文，保存的内容里没有上一题的文本", async () => {
  const user = await startApp();
  await user.click(screen.getByText("2024-2"));
  await editorShows("求矩阵秩。");

  pasteAll("粘贴的新内容");
  expect(run(undo)).toBe(true);
  await editorShows("求矩阵秩。");
  run(undo);
  await editorShows("求矩阵秩。");

  await waitForSaves(1);
  const last = savedBanks().at(-1)!;
  expect(questionTex(last, "matrix")).toBe("求矩阵秩。");
  expect(questionTex(last, "limit")).toBe("求极限 $x$。");
  expect(savedBanks().some((saved) => questionTex(saved, "matrix") === "求极限 $x$。")).toBe(false);
});

it("外部同步替换了当前题后，撤销不会回到同步前的本地文本", async () => {
  await startApp();
  pasteAll("本地粘贴");
  await waitForSaves(1);
  const savesBeforeSync = savedBanks().length;

  setFixtureBank(withQuestion("limit", "外部更新后的题干"));
  FakeEventSource.instances.at(-1)!.emit("bank-changed", IMPORT_EVENT);
  await editorShows("外部更新后的题干");

  expect(undoDepth(currentView().state)).toBe(0);
  expect(run(undo)).toBe(false);
  await editorShows("外部更新后的题干");
  await act(() => new Promise((resolve) => setTimeout(resolve, 800)));
  const later = savedBanks().slice(savesBeforeSync);
  expect(later.some((saved) => ["本地粘贴", "求极限 $x$。"].includes(questionTex(saved, "limit") ?? ""))).toBe(false);
});

it("外部同步后当前题文本不变（同 ID、同文本），重做也不会带回同步前撤销掉的草稿", async () => {
  await startApp();
  pasteAll("临时草稿");
  run(undo);
  await editorShows("求极限 $x$。");
  await waitForSaves(1);
  const before = currentView();

  setFixtureBank(withQuestion("matrix", "别的题被外部修改"));
  FakeEventSource.instances.at(-1)!.emit("bank-changed", IMPORT_EVENT);
  await waitFor(() => expect(currentView()).not.toBe(before));
  await editorShows("求极限 $x$。");

  expect(run(redo)).toBe(false);
  await editorShows("求极限 $x$。");
});

it("外部同步请求期间开始编辑：不覆盖新输入，改为显示横幅", async () => {
  await startApp();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    if (String(input) === "/api/bank" && !init?.method) await gate;
    return handleFetch(input, init);
  });

  setFixtureBank(withQuestion("matrix", "别的题被外部修改"));
  FakeEventSource.instances.at(-1)!.emit("bank-changed", IMPORT_EVENT);
  pasteAll("请求期间的输入");
  await act(async () => {
    release();
    await gate;
  });

  expect(await screen.findByText("题库已在外部更新")).toBeInTheDocument();
  await editorShows("请求期间的输入");
  expect(run(undo)).toBe(true);
  await editorShows("求极限 $x$。");
});

it("在编辑器里用 ⌘K 跳到另一题后，焦点交给新题的编辑器", async () => {
  const user = await startApp();
  // jsdom 不把 contenteditable 当作可聚焦元素：给旧编辑器补 tabindex，模拟浏览器里的焦点
  const oldContent = currentView().contentDOM;
  oldContent.setAttribute("tabindex", "0");
  oldContent.focus();
  expect(document.activeElement).toBe(oldContent);
  const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");

  await user.keyboard("{Control>}k{/Control}");
  await user.type(await screen.findByLabelText("搜索题目或命令"), "2024-2");
  await user.keyboard("{Enter}");
  await editorShows("求矩阵秩。");

  await waitFor(() => {
    const newContent = currentView().contentDOM;
    expect(newContent).not.toBe(oldContent);
    expect(focusSpy.mock.contexts).toContain(newContent);
  });
});
