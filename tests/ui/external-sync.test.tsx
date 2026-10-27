import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { Bank } from "../../shared/types.js";
import App from "../../src/App.js";
import {
  bank,
  setFixtureBank,
  setupAppFixture
} from "../fixtures/app-ui.js";

vi.mock("../../src/components/LatexEditor.js", () => ({
  default: ({ value }: { value: string }) => (
    <textarea aria-label="latex-editor" readOnly value={value} />
  )
}));

setupAppFixture();

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  private listeners = new Map<string, Set<EventListener>>();

  constructor(public readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const callback =
      typeof listener === "function"
        ? listener
        : (event: Event) => listener.handleEvent(event);
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(callback);
    this.listeners.set(type, listeners);
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject
  ) {
    if (typeof listener === "function") {
      this.listeners.get(type)?.delete(listener);
    }
  }

  close(): void {}

  emit(type: string, data: unknown): void {
    const event = new MessageEvent(type, {
      data: JSON.stringify(data)
    });
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

afterEach(() => {
  FakeEventSource.instances = [];
  vi.unstubAllGlobals();
});

it("auto-reloads an idle app after an agent import event", async () => {
  vi.stubGlobal(
    "EventSource",
    FakeEventSource as unknown as typeof EventSource
  );
  render(<App />);
  await screen.findByText("2024-1");
  await waitFor(() =>
    expect(FakeEventSource.instances.length).toBeGreaterThan(0)
  );

  setFixtureBank(importedBank());
  const source = FakeEventSource.instances.at(-1)!;
  source.emit("bank-changed", {
    workspacePath: "/tmp/latex-bank",
    revision: "revision-import",
    counts: {
      created: 1,
      updated: 0,
      skipped: 0,
      conflicts: 0,
      assets: 0
    }
  });

  expect(await screen.findByText("导入题")).toBeInTheDocument();
  expect(await screen.findByText("已导入 1 道题。")).toBeInTheDocument();
});

it("shows an undo notice after an agent batch-undo event", async () => {
  vi.stubGlobal(
    "EventSource",
    FakeEventSource as unknown as typeof EventSource
  );
  render(<App />);
  await screen.findByText("2024-1");
  await waitFor(() =>
    expect(FakeEventSource.instances.length).toBeGreaterThan(0)
  );

  setFixtureBank(bank);
  const source = FakeEventSource.instances.at(-1)!;
  source.emit("bank-changed", {
    workspacePath: "/tmp/latex-bank",
    revision: "revision-undo",
    source: "agent-undo",
    counts: {
      created: 0,
      updated: 0,
      skipped: 0,
      conflicts: 0,
      assets: 1
    },
    undoCounts: {
      deleted: 1,
      restored: 0,
      kept: 0,
      assetsRemoved: 1
    }
  });

  expect(
    await screen.findByText("已撤销导入批次：删除 1 道，恢复 0 道。")
  ).toBeInTheDocument();
});

it("keeps local edits and shows a banner while an input is focused", async () => {
  vi.stubGlobal(
    "EventSource",
    FakeEventSource as unknown as typeof EventSource
  );
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText("2024-1");
  await waitFor(() =>
    expect(FakeEventSource.instances.length).toBeGreaterThan(0)
  );
  await user.click(screen.getByLabelText("来源题号"));

  setFixtureBank(importedBank());
  const source = FakeEventSource.instances.at(-1)!;
  source.emit("bank-changed", {
    workspacePath: "/tmp/latex-bank",
    revision: "revision-import",
    counts: {
      created: 1,
      updated: 0,
      skipped: 0,
      conflicts: 0,
      assets: 0
    }
  });

  expect(await screen.findByText("题库已在外部更新")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "稍后" }));
  expect(screen.queryByText("题库已在外部更新")).not.toBeInTheDocument();
  expect(screen.queryByText("导入题")).not.toBeInTheDocument();
});

it("reloads an idle app after an agent tag change", async () => {
  vi.stubGlobal(
    "EventSource",
    FakeEventSource as unknown as typeof EventSource
  );
  render(<App />);
  await screen.findByText("2024-1");
  await waitFor(() =>
    expect(FakeEventSource.instances.length).toBeGreaterThan(0)
  );

  setFixtureBank(taggedBank());
  FakeEventSource.instances.at(-1)!.emit("bank-changed", {
    workspacePath: "/tmp/latex-bank",
    revision: "revision-tags",
    source: "agent-tags",
    tagCounts: { changed: 1, unchanged: 0, added: 1, removed: 0 }
  });

  expect(await screen.findByText("已更新 1 道题的标签。")).toBeInTheDocument();
  expect(
    await screen.findByRole("button", { name: "删除标签 考点·极限" })
  ).toBeInTheDocument();
});

it("describes a tag change in the banner while an input is focused", async () => {
  vi.stubGlobal(
    "EventSource",
    FakeEventSource as unknown as typeof EventSource
  );
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText("2024-1");
  await waitFor(() =>
    expect(FakeEventSource.instances.length).toBeGreaterThan(0)
  );
  await user.click(screen.getByLabelText("来源题号"));

  setFixtureBank(taggedBank());
  FakeEventSource.instances.at(-1)!.emit("bank-changed", {
    workspacePath: "/tmp/latex-bank",
    revision: "revision-tags",
    source: "agent-tags",
    tagCounts: { changed: 3, unchanged: 0, added: 3, removed: 0 }
  });

  expect(await screen.findByText("题库已在外部更新")).toBeInTheDocument();
  expect(screen.getByText(/Agent 修改了 3 道题的标签。/)).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "删除标签 考点·极限" })
  ).not.toBeInTheDocument();
});

function taggedBank(): Bank {
  return {
    ...bank,
    items: bank.items.map((item) =>
      item.id === "limit"
        ? { ...item, tags: [...item.tags, "考点·极限"] }
        : item
    )
  };
}

function importedBank(): Bank {
  const template = bank.items[0];
  const now = "2026-01-01T00:00:00.000Z";
  return {
    ...bank,
    items: [
      ...bank.items,
      {
        ...template,
        id: "imported",
        source: { bookId: null, label: "导入题" },
        chapterId: null,
        chapterOrder: 1,
        tags: ["导入"],
        reviewPriority: "must",
        reviewStatus: "pending",
        solutionSource: "agent",
        modules: {
          question: { tex: "导入题面。" },
          solution: { tex: "" },
          note: { tex: "" }
        },
        assets: [],
        createdAt: now,
        updatedAt: now
      }
    ]
  };
}
