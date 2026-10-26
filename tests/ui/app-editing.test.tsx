import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { Bank } from "../../shared/types.js";

import {
  bank,
  createBookLinkedConflictBank,
  handleFetch,
  json,
  setFixtureBank,
  setupAppFixture
} from "../fixtures/app-ui.js";
import { userEvent } from "@testing-library/user-event";
import App from "../../src/App.js";
vi.mock("../../src/components/LatexEditor.js", () => ({
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea aria-label="latex-editor" value={value} onChange={(event) => onChange(event.target.value)} />
  )
}));


setupAppFixture();

it("autosaves metadata edits", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("2024-1");

    const sourceInput = screen.getByDisplayValue("2024-1");
    await user.clear(sourceInput);
    await user.type(sourceInput, "2026-1");
    await user.tab();
    await new Promise((resolve) => window.setTimeout(resolve, 650));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/bank",
        expect.objectContaining({
          method: "PUT"
        })
      );
    });
  });

it("commits multiple tags with English and Chinese commas", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("2024-1");

    const metadata = screen.getByRole("region", { name: "题目元数据" });
    const tagInput = within(metadata).getByLabelText("添加标签");
    await user.type(tagInput, "导数,函数，");

    expect(within(metadata).getByText("导数")).toBeInTheDocument();
    expect(within(metadata).getByText("函数")).toBeInTheDocument();
  });

it("opens the independent settings page and edits chapters, books, and LaTeX", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("2024-1");
    expect(screen.queryByRole("heading", { name: "工作区" }))
      .not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "题库设置" }));
    expect(await screen.findByRole("heading", { name: "题库设置" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "工作区" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "TeX 可用" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "书目" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Agent 导入记录" })).toBeInTheDocument();
    expect(screen.queryByText("星级")).not.toBeInTheDocument();

    const chapterName = screen.getByLabelText("章节名称 高等数学/极限");
    await user.clear(chapterName);
    await user.type(chapterName, "微积分/极限");
    await user.tab();
    expect(await screen.findByText("章节名称已更新。")).toBeInTheDocument();

    const booksSection = screen.getByRole("heading", { name: "书目" })
      .closest("section")!;
    await user.type(within(booksSection).getByLabelText("新书目名称"), "测试书");
    await user.click(within(booksSection).getByRole("button", { name: "新建书目" }));
    expect(within(booksSection).getByLabelText("书目名称 测试书"))
      .toBeInTheDocument();
    const bookName = within(booksSection).getByLabelText("书目名称 测试书");
    await user.clear(bookName);
    await user.type(bookName, "测试书二");
    await user.tab();
    expect(await screen.findByText("书目名称已更新。")).toBeInTheDocument();
    const pdfPath = within(booksSection).getByLabelText("测试书二 的 PDF 路径");
    await user.type(pdfPath, "/tmp/book.pdf");
    await user.tab();
    expect(pdfPath).toHaveValue("/tmp/book.pdf");
    await user.click(within(booksSection).getByRole("button", {
      name: "删除书目 测试书二"
    }));
    expect(within(booksSection).queryByLabelText("书目名称 测试书二"))
      .not.toBeInTheDocument();

    const latexSection = screen.getByRole("heading", { name: "LaTeX" })
      .closest("section")!;
    await user.clear(within(latexSection).getByLabelText("题间距"));
    await user.type(within(latexSection).getByLabelText("题间距"), "2em");
    expect(within(latexSection).getByLabelText("题间距")).toHaveValue("2em");
  });

it("creates, reorders, validates, and deletes settings definitions", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("2024-1");
    await user.click(screen.getByRole("button", { name: "题库设置" }));

    const chapterSection = screen.getByRole("heading", { name: "章节" })
      .closest("section")!;
    await user.type(
      within(chapterSection).getByLabelText("新章节名称"),
      "概率论{Enter}"
    );
    expect(within(chapterSection).getByLabelText("章节名称 概率论"))
      .toBeInTheDocument();
    await user.click(
      within(chapterSection).getByRole("button", {
        name: "上移章节 概率论"
      })
    );
    await user.click(
      within(chapterSection).getByRole("button", {
        name: "下移章节 概率论"
      })
    );
    const probabilityRow = within(chapterSection)
      .getByLabelText("章节名称 概率论").closest("[draggable=true]")!;
    const calculusRow = within(chapterSection)
      .getByLabelText("章节名称 高等数学/极限").closest("[draggable=true]")!;
    fireEvent.dragStart(probabilityRow);
    fireEvent.dragOver(calculusRow);
    fireEvent.drop(calculusRow);
    fireEvent.dragEnd(probabilityRow);
    await user.click(
      within(chapterSection).getByRole("button", {
        name: "删除章节 概率论"
      })
    );
    expect(within(chapterSection).queryByLabelText("章节名称 概率论"))
      .not.toBeInTheDocument();

    const latexSection = screen.getByRole("heading", { name: "LaTeX" })
      .closest("section")!;
    await user.clear(within(latexSection).getByLabelText("题间距"));
    await user.type(within(latexSection).getByLabelText("题间距"), "2em");
    await user.clear(within(latexSection).getByLabelText("模块间距"));
    await user.type(within(latexSection).getByLabelText("模块间距"), "1em");
    await user.clear(within(latexSection).getByLabelText("导言区"));
    await user.type(within(latexSection).getByLabelText("导言区"), "% custom");
    await user.click(within(latexSection).getByRole("button", {
      name: "TeX 可用"
    }));
    expect(await screen.findByText("已检测到 LaTeX：latexmk"))
      .toBeInTheDocument();
  });

it("uses narrow desktop capabilities for workspace and TeX actions", async () => {
    const selectWorkspaceDirectory = vi.fn()
      .mockResolvedValueOnce("/tmp/new-bank")
      .mockResolvedValueOnce("/tmp/open-bank");
    const openPath = vi.fn().mockResolvedValue("");
    window.lqb = {
      platform: "darwin",
      selectWorkspaceDirectory,
      openPath,
      revealExportFolder: vi.fn().mockResolvedValue(true),
      openExternal: vi.fn().mockResolvedValue(true),
      onBeforeClose: vi.fn(() => () => undefined)
    };
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("2024-1");
    await user.click(screen.getByRole("button", { name: "题库设置" }));

    await user.click(screen.getByTitle("在文件管理器中显示当前工作区"));
    expect(openPath).toHaveBeenCalledWith("/tmp/latex-bank");

    await user.click(screen.getByTitle("新建空工作区"));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/workspaces/create-empty",
        expect.objectContaining({ method: "POST" })
      )
    );
    await user.click(screen.getByTitle("打开已有工作区"));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/workspaces/open",
        expect.objectContaining({ method: "POST" })
      )
    );

    const latexSection = screen.getByRole("heading", { name: "LaTeX" })
      .closest("section")!;
    const texPath = within(latexSection).getByLabelText("latexmk 路径");
    await user.type(texPath, "/usr/local/bin/latexmk");
    texPath.blur();
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/tex-path",
        expect.objectContaining({ method: "POST" })
      )
    );
  });

it("offers all three insertion locations and focuses newly inserted items", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("2024-1");

    await user.click(screen.getByRole("button", { name: "打开新增题目菜单" }));
    expect(screen.getByRole("menuitem", { name: "在当前题后插入" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "在当前章末插入" })).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "在末尾插入（未分类）" })
    ).toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: "在当前章末插入" }));
    await waitFor(() =>
      expect(
        screen.getAllByRole("checkbox", { name: /选择导出/ })
      ).toHaveLength(3)
    );
    await waitFor(() =>
      expect(document.activeElement?.id).toMatch(/^question-nav-/)
    );

    await user.click(screen.getByRole("button", { name: "打开新增题目菜单" }));
    await user.click(
      screen.getByRole("menuitem", { name: "在末尾插入（未分类）" })
    );
    await waitFor(() =>
      expect(
        screen.getAllByRole("checkbox", { name: /选择导出/ })
      ).toHaveLength(4)
    );
    expect(screen.getByLabelText("选择章节")).toHaveValue("");
  });

it("moves, validates, deletes, and restores questions", async () => {
    const sameChapterBank: Bank = {
      ...bank,
      items: bank.items.map((item, index) => ({
        ...item,
        chapterId: "chapter-calculus",
        chapterOrder: index + 1
      }))
    };
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input) === "/api/bank" && !init?.method) {
        return json({
          workspacePath: "/tmp/latex-bank",
          revision: "question-actions",
          bank: sameChapterBank
        });
      }
      return handleFetch(input, init);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("2024-1");

    await user.click(screen.getByRole("button", { name: "下移" }));
    await user.click(screen.getByRole("button", { name: "上移" }));
    await user.click(screen.getByRole("button", { name: "更改题序" }));
    const dialog = screen.getByRole("dialog", { name: "更改题序" });
    const target = within(dialog).getByLabelText("目标题序");
    await user.clear(target);
    await user.type(target, "x");
    await user.click(within(dialog).getByRole("button", { name: "确认" }));
    expect(within(dialog).getByText("请输入有效的整数题序。"))
      .toBeInTheDocument();
    await user.clear(target);
    await user.type(target, "2");
    await user.click(within(dialog).getByRole("button", { name: "确认" }));
    expect(await screen.findByText("已移动至第 2 题。")).toBeInTheDocument();

    vi.mocked(window.confirm).mockReturnValueOnce(false);
    await user.click(screen.getByRole("button", { name: "删除题目" }));
    expect(screen.getByText("2024-1")).toBeInTheDocument();
    vi.mocked(window.confirm).mockReturnValueOnce(true);
    await user.click(screen.getByRole("button", { name: "删除题目" }));
    expect(await screen.findByText("题目已删除，可在 10 秒内撤销。"))
      .toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "撤销" }));
    expect(await screen.findByText("已撤销删除。")).toBeInTheDocument();
    expect(screen.getByText("2024-1")).toBeInTheDocument();
  });

it("rejects a new source conflict inside the same book", async () => {
    setFixtureBank(createBookLinkedConflictBank());
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("测试书 2024-1");

    await user.click(screen.getByText("测试书 2024-2"));
    const sourceInput = screen.getByDisplayValue("2024-2");
    await user.clear(sourceInput);
    await user.type(sourceInput, "2024-1");
    // draft-only:仅在 blur/Enter 时提交并校验冲突
    await user.tab();

    expect(
      await screen.findByText(/来源题号“2024-1”已被其他题目使用/)
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("2024-1")).toBeInTheDocument();
  });

it("allows typing a source label whose prefix collides with a sibling", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("2024-1");

    await user.click(screen.getByText("2024-2"));
    const sourceInput = screen.getByDisplayValue("2024-2");
    await user.clear(sourceInput);
    // 输入过程中会经过与 2024-1 冲突的前缀;draft-only 不应中途拒绝或跳转
    await user.type(sourceInput, "2024-11");
    expect(sourceInput).toHaveValue("2024-11");
    expect(screen.queryByText(/已被使用/)).not.toBeInTheDocument();

    // blur 提交合法的完整题号
    await user.tab();
    expect(screen.getByDisplayValue("2024-11")).toBeInTheDocument();
  });

it("protects a book that is still referenced by questions", async () => {
    setFixtureBank(createBookLinkedConflictBank());
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("测试书 2024-1");
    await user.click(screen.getByRole("button", { name: "题库设置" }));
    const deleteButton = screen.getByRole("button", { name: "删除书目 测试书" });
    expect(deleteButton).toBeDisabled();
    expect(deleteButton).toHaveAttribute(
      "title",
      "仍有 2 道题引用，无法删除"
    );
  });

it("clears a book hash when its path changes and protects referenced books", async () => {
    const hashedBank = createBookLinkedConflictBank();
    const now = "2026-01-01T00:00:00.000Z";
    setFixtureBank({
      ...hashedBank,
      books: hashedBank.books.map((book) => ({
        ...book,
        filePath: "/tmp/old.pdf",
        fileHash: "a".repeat(64)
      })),
      imports: [
        {
          id: "book-batch-1",
          createdAt: now,
          note: "整书导入",
          bookTitles: ["测试书"],
          newCount: 2,
          updatedCount: 0,
          skippedCount: 0,
          conflictCount: 0,
          itemIds: ["limit", "matrix"],
          updatedItemIds: [],
          historySnapshot: "snapshot.json",
          status: "partial",
          undoneAt: null
        }
      ]
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/2024-1/);
    await user.click(screen.getByRole("button", { name: "题库设置" }));

    const deleteBook = await screen.findByRole("button", {
      name: "删除书目 测试书"
    });
    expect(deleteBook).toBeDisabled();
    expect(deleteBook).toHaveAttribute(
      "title",
      "仍有 2 道题引用，无法删除"
    );
    expect(screen.getByText(/PDF：哈希已记录/)).toBeInTheDocument();
    expect(screen.getByText("book-batch-1")).toBeInTheDocument();
    expect(screen.getByText("部分完成")).toBeInTheDocument();

    const pdfPath = screen.getByLabelText("测试书 的 PDF 路径");
    await user.clear(pdfPath);
    await user.type(pdfPath, "/tmp/new.pdf");
    await user.tab();
    expect(
      await screen.findByText("书目路径已更新，对应文件哈希已清空。")
    ).toBeInTheDocument();
    expect(screen.getByText(/PDF：缺少哈希/)).toBeInTheDocument();
  });

it("approves a pending item from the metadata panel", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("2024-1");
    expect(screen.getByText("其中 1 道待审阅")).toBeInTheDocument();

    await user.click(screen.getByText("2024-2"));
    const metadata = screen.getByRole("region", { name: "题目元数据" });
    expect(within(metadata).getByText("待审阅")).toBeInTheDocument();
    await user.click(within(metadata).getByRole("button", { name: "批准" }));

    expect(within(metadata).queryByText("待审阅")).not.toBeInTheDocument();
    expect(screen.queryByText("其中 1 道待审阅")).not.toBeInTheDocument();
    const row = document.getElementById("question-nav-matrix");
    expect(within(row!).queryByText("待审阅")).not.toBeInTheDocument();
  });

it("autosaves module edits in the launch schema", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("2024-1");

    const editors = screen.getAllByLabelText("latex-editor");
    await user.clear(editors[0]);
    await user.type(editors[0], "新版题面");
    await new Promise((resolve) => window.setTimeout(resolve, 650));

    await waitFor(() => {
      const saveCall = vi.mocked(fetch).mock.calls.find(
        ([url, init]) => String(url) === "/api/bank" && init?.method === "PUT"
      );
      expect(saveCall).toBeTruthy();
      const payload = JSON.parse(String(saveCall?.[1]?.body)) as { bank: Bank };
      expect(payload.bank.version).toBe(3);
      expect(payload.bank.items[0].modules.question.tex).toBe("新版题面");
    });
  });
