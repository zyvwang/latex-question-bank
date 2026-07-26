import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../src/App.js";
import type { AppInfo, Bank } from "../../shared/types.js";

vi.mock("../../src/components/LatexEditor.js", () => ({
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea aria-label="latex-editor" value={value} onChange={(event) => onChange(event.target.value)} />
  )
}));

const appInfo: AppInfo = {
  appState: {
    version: 1,
    currentWorkspacePath: "/tmp/latex-bank",
    recentWorkspacePaths: ["/tmp/latex-bank", "/tmp/other-bank"]
  },
  currentWorkspaceName: "latex-bank",
  currentWorkspacePath: "/tmp/latex-bank",
  recentWorkspaces: [
    { name: "latex-bank", path: "/tmp/latex-bank", exists: true },
    { name: "other-bank", path: "/tmp/other-bank", exists: true }
  ],
  texStatus: {
    available: true,
    command: "latexmk",
    source: "path",
    message: "已检测到 LaTeX：latexmk"
  },
  isDesktop: false,
  setupRequired: false
};

const bank: Bank = {
  version: 2,
  settings: {
    pageSize: "a4",
    spacing: { item: "1.0em", module: "0.45em" },
    preamble: "% test"
  },
  chapters: [
    { id: "chapter-calculus", name: "高等数学/极限", order: 1 },
    { id: "chapter-linear-algebra", name: "线性代数/矩阵", order: 2 }
  ],
  masteryOptions: [
    { id: "mastery-easy", name: "很简单", order: 1, color: "#2F766F", pattern: "solid" },
    { id: "mastery-hard", name: "太难了", order: 2, color: "#B84A3A", pattern: "crosshatch" }
  ],
  errorReasonOptions: [
    { id: "error-calculation", name: "计算问题", order: 1, color: "#A9571C", pattern: "diagonal" },
    { id: "error-method", name: "方法问题", order: 2, color: "#74558F", pattern: "crosshatch" }
  ],
  masteryHistory: [],
  items: [
    {
      id: "limit",
      sourceNumber: "2024-1",
      chapterId: "chapter-calculus",
      chapterOrder: 1,
      tags: ["极限"],
      masteryOptionId: "mastery-hard",
      errorReasonOptionIds: ["error-method"],
      modules: {
        question: { tex: "求极限 $x$。" },
        solution: { tex: "答案。" },
        note: { tex: "备注。" }
      },
      assets: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    {
      id: "matrix",
      sourceNumber: "2024-2",
      chapterId: "chapter-linear-algebra",
      chapterOrder: 1,
      tags: ["矩阵"],
      masteryOptionId: "mastery-easy",
      errorReasonOptionIds: ["error-calculation"],
      modules: {
        question: { tex: "求矩阵秩。" },
        solution: { tex: "答案。" },
        note: { tex: "" }
      },
      assets: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }
  ]
};

let nextExportName = "questions-2026-06-13-1";
let compileResponder: (() => Promise<Response>) | null = null;

beforeEach(() => {
  vi.useRealTimers();
  nextExportName = "questions-2026-06-13-1";
  compileResponder = null;
  vi.stubGlobal("fetch", vi.fn(handleFetch));
  vi.spyOn(window, "confirm").mockReturnValue(true);
  delete window.lqb;
});

describe("App UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("offers blank, existing, and sample banks on first launch", async () => {
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/app") {
        return json({
          ...appInfo,
          appState: { version: 1, recentWorkspacePaths: [] },
          currentWorkspaceName: "未设置",
          currentWorkspacePath: "",
          recentWorkspaces: [],
          setupRequired: true
        });
      }
      return handleFetch(input, init);
    });

    render(<App />);

    expect(await screen.findByText("建立你的第一个题库")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建空白题库" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开已有题库" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "体验示例题库" })).toBeInTheDocument();
    expect(
      vi.mocked(fetch).mock.calls.some(([input]) => String(input) === "/api/bank")
    ).toBe(false);
  });

  it("loads the workspace and filters items", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByText("LaTeX 题库")).toBeInTheDocument();
    expect(await screen.findByText("2024-1")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("搜索"), "矩阵");
    expect(screen.queryByText("2024-1")).not.toBeInTheDocument();
    expect(screen.getByText("2024-2")).toBeInTheDocument();
  });

  it("shows complete review marks and separate chapter and tag tokens", async () => {
    const statusBank: Bank = {
      ...bank,
      items: bank.items.map((item, index) => index === 0
        ? {
            ...item,
            tags: ["极限", "含参数的分段函数连续性分类讨论"],
            errorReasonOptionIds: ["error-calculation", "error-method"]
          }
        : {
            ...item,
            chapterId: null,
            masteryOptionId: null,
            errorReasonOptionIds: []
          })
    };
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input) === "/api/bank" && !init) {
        return json({
          workspacePath: "/tmp/latex-bank",
          revision: "revision-status",
          bank: statusBank
        });
      }
      return handleFetch(input, init);
    });

    render(<App />);
    await screen.findByText("2024-1");
    const first = document.getElementById("question-nav-limit");
    expect(first).not.toBeNull();
    expect(within(first!).getByLabelText(
      "掌握程度：太难了；错误原因：计算问题、方法问题"
    )).toBeInTheDocument();
    expect(within(first!).getByText("高等数学/极限")).toBeInTheDocument();
    expect(within(first!).getByText("极限")).toBeInTheDocument();
    expect(within(first!).getByText(
      "含参数的分段函数连续性分类讨论"
    )).toBeInTheDocument();

    const second = document.getElementById("question-nav-matrix");
    expect(second).not.toBeNull();
    expect(within(second!).getByLabelText(
      "掌握程度：未设置；错误原因：未设置"
    )).toBeInTheDocument();
    expect(within(second!).getByText("未分类")).toBeInTheDocument();
  });

  it("combines multi-value review filters with OR inside fields and AND across fields", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("2024-1");

    const masterySummary = screen.getByLabelText("掌握程度筛选，已选 0 项");
    await user.click(masterySummary);
    const masteryMenu = masterySummary.closest("details");
    expect(masteryMenu).not.toBeNull();
    await user.click(within(masteryMenu!).getByRole("checkbox", { name: "太难了" }));
    expect(screen.getByText("2024-1")).toBeInTheDocument();
    expect(screen.queryByText("2024-2")).not.toBeInTheDocument();

    const errorSummary = screen.getByLabelText("错误原因筛选，已选 0 项");
    await user.click(errorSummary);
    const errorMenu = errorSummary.closest("details");
    expect(errorMenu).not.toBeNull();
    await user.click(within(errorMenu!).getByRole("checkbox", { name: "计算问题" }));
    expect(screen.getByText("当前筛选没有匹配题目。")).toBeInTheDocument();

    await user.click(within(errorMenu!).getByRole("checkbox", { name: "方法问题" }));
    expect(screen.getByText("2024-1")).toBeInTheDocument();
    expect(screen.queryByText("2024-2")).not.toBeInTheDocument();

    await user.click(within(masteryMenu!).getByRole("checkbox", { name: "很简单" }));
    expect(screen.getByText("2024-1")).toBeInTheDocument();
    expect(screen.getByText("2024-2")).toBeInTheDocument();
  });

  it("switches selected list without applying or losing current filters", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("2024-1");

    await user.click(
      screen.getByRole("checkbox", { name: "选择导出 2024-2" })
    );
    await user.type(screen.getByLabelText("搜索题目"), "矩阵");
    expect(screen.queryByText("2024-1")).not.toBeInTheDocument();
    expect(screen.getByText("2024-2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "切换到已选中列表" }));
    expect(screen.getByText("筛选已保留，返回当前列表后继续生效。")).toBeInTheDocument();
    expect(screen.getByText("2024-1")).toBeInTheDocument();
    expect(screen.queryByText("2024-2")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "返回当前列表" }));
    expect(screen.queryByText("2024-1")).not.toBeInTheDocument();
    expect(screen.getByText("2024-2")).toBeInTheDocument();
  });

  it("keeps export selection independent from filters and resets it on workspace switch", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("2024-1");

    await user.type(screen.getByLabelText("搜索题目"), "矩阵");
    await user.click(screen.getByRole("button", { name: "导出 2 题" }));
    const exportCall = vi.mocked(fetch).mock.calls.find(
      ([url]) => String(url) === "/api/export"
    );
    const exportRequest = JSON.parse(String(exportCall?.[1]?.body)) as {
      itemIds: string[];
    };
    expect(exportRequest.itemIds).toEqual(["limit", "matrix"]);

    await user.click(
      screen.getByRole("checkbox", { name: "选择导出 2024-2" })
    );
    await user.click(screen.getByRole("button", { name: "题库设置" }));
    await user.click(screen.getByRole("button", { name: /other-bank/ }));
    expect(await screen.findByRole("heading", { name: "题库设置" }))
      .toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "编辑" }));
    await waitFor(() =>
      expect(
        screen.getAllByRole("checkbox", { name: /选择导出/ })
      ).toHaveLength(2)
    );
    for (const checkbox of screen.getAllByRole("checkbox", { name: /选择导出/ })) {
      expect(checkbox).toBeChecked();
    }
  });

  it("switches focused modules with the keyboard without an overview mode", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("2024-1");

    const questionTab = screen.getByRole("tab", { name: /题目/ });
    questionTab.focus();
    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("tab", { name: /解析/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("latex-editor")).toHaveValue("答案。");
    expect(screen.queryByRole("button", { name: "总览" })).not.toBeInTheDocument();
  });

  it("binds compile success to the checked item and exact content version", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("2024-1");

    await user.click(screen.getByRole("button", { name: "检查当前题" }));
    const successText = await screen.findByText("当前题编译通过。");
    expect(within(successText.parentElement!).getByRole("button", { name: "打开" })).toBeInTheDocument();

    await user.click(screen.getByText("2024-2"));
    expect(await screen.findByText("编译结果已过期，请重新检查。")).toBeInTheDocument();
    await user.click(screen.getByText("2024-1"));
    expect(await screen.findByText("当前题编译通过。")).toBeInTheDocument();

    const editor = screen.getByLabelText("latex-editor");
    await user.type(editor, "修改");
    const staleText = await screen.findByText("编译结果已过期，请重新检查。");
    expect(within(staleText.parentElement!).queryByRole("button", { name: "打开" })).not.toBeInTheDocument();
  });

  it("marks an in-flight compile stale when content changes", async () => {
    const user = userEvent.setup();
    let resolveCompile: ((response: Response) => void) | undefined;
    compileResponder = () => new Promise<Response>((resolve) => {
      resolveCompile = resolve;
    });
    render(<App />);
    await screen.findByText("2024-1");

    await user.click(screen.getByRole("button", { name: "检查当前题" }));
    expect(await screen.findByText("正在编译当前题。")).toBeInTheDocument();
    await user.type(screen.getByLabelText("latex-editor"), "修改");
    expect(await screen.findByText("编译内容已变化，完成后结果将过期。")).toBeInTheDocument();

    resolveCompile?.(compileSuccess());
    expect(await screen.findByText("编译结果已过期，请重新检查。")).toBeInTheDocument();
  });

  it("hides a compile failure log after switching items", async () => {
    const user = userEvent.setup();
    compileResponder = async () => json({
      ok: false,
      texPath: "/tmp/current-item.tex",
      texUrl: "/tmp/current-item.tex",
      log: "Undefined control sequence"
    }, 422);
    render(<App />);
    await screen.findByText("2024-1");

    await user.click(screen.getByRole("button", { name: "检查当前题" }));
    expect(await screen.findByText("Undefined control sequence")).toBeInTheDocument();
    await user.click(screen.getByText("2024-2"));
    expect(screen.queryByText("Undefined control sequence")).not.toBeInTheDocument();
    expect(await screen.findByText("编译结果已过期，请重新检查。")).toBeInTheDocument();
  });

  it("autosaves metadata edits", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("2024-1");

    const sourceInput = screen.getByDisplayValue("2024-1");
    await user.clear(sourceInput);
    await user.type(sourceInput, "2026-1");
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

  it("opens the independent settings page and edits chapters and review options", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("2024-1");
    expect(screen.queryByRole("heading", { name: "工作区" }))
      .not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "题库设置" }));
    expect(await screen.findByRole("heading", { name: "题库设置" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "工作区" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "TeX 可用" })).toBeInTheDocument();
    expect(screen.queryByText("星级")).not.toBeInTheDocument();

    const chapterName = screen.getByLabelText("章节名称 高等数学/极限");
    await user.clear(chapterName);
    await user.type(chapterName, "微积分/极限");
    await user.tab();
    expect(await screen.findByText("章节名称已更新。")).toBeInTheDocument();

    const hardColor = screen.getByLabelText("太难了颜色");
    await user.clear(hardColor);
    await user.type(hardColor, "#9B3C31");
    await user.tab();
    expect(await screen.findByText("选项已更新。")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "编辑" }));
    expect(await screen.findByRole("radio", { name: /太难了/ })).toBeChecked();
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

    const masterySection = screen.getByRole("heading", {
      name: "掌握程度"
    }).closest("section")!;
    await user.type(
      within(masterySection).getByLabelText("新建掌握程度名称"),
      "待复习"
    );
    await user.selectOptions(
      within(masterySection).getByLabelText("新建掌握程度图案"),
      "dots"
    );
    await user.click(within(masterySection).getByRole("button", {
      name: "新建"
    }));
    expect(within(masterySection).getByLabelText("选项名称 待复习"))
      .toBeInTheDocument();
    await user.selectOptions(
      within(masterySection).getByLabelText("待复习图案"),
      "diagonal"
    );
    await user.click(within(masterySection).getByRole("button", {
      name: "上移选项 待复习"
    }));
    const optionRow = within(masterySection)
      .getByLabelText("选项名称 待复习").closest("[draggable=true]")!;
    const hardRow = within(masterySection)
      .getByLabelText("选项名称 太难了").closest("[draggable=true]")!;
    fireEvent.dragStart(optionRow);
    fireEvent.drop(hardRow);
    fireEvent.dragEnd(optionRow);
    await user.click(within(masterySection).getByRole("button", {
      name: "删除选项 待复习"
    }));
    expect(within(masterySection).queryByLabelText("选项名称 待复习"))
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
      if (String(input) === "/api/bank" && !init) {
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

  it("rejects a new source-number conflict inside the same chapter", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("2024-1");

    await user.click(screen.getByText("2024-2"));
    await user.selectOptions(
      screen.getByLabelText("选择章节"),
      "chapter-calculus"
    );
    const sourceInput = screen.getByDisplayValue("2024-2");
    await user.clear(sourceInput);
    await user.type(sourceInput, "2024-1");

    expect(
      await screen.findByText(/原编号“2024-1”在当前章节中已被使用/)
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("2024-1")).toBeInTheDocument();
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
      expect(payload.bank.version).toBe(2);
      expect(payload.bank.items[0].modules.question.tex).toBe("新版题面");
    });
  });

  it("uploads an image into the active module", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await screen.findByText("2024-1");

    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    await user.upload(input!, new File(["image"], "figure.png", { type: "image/png" }));

    expect(await screen.findByText("图片已插入当前模块。")).toBeInTheDocument();
  });

  it("increments an automatic export name and opens its file location", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("2024-1");
    expect(await screen.findByLabelText("导出名")).toHaveValue("questions-2026-06-13-1");

    await user.click(screen.getByRole("button", { name: /导出 2 题/ }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/export",
        expect.objectContaining({
          method: "POST"
        })
      );
    });
    expect(await screen.findByText(/导出完成/)).toBeInTheDocument();
    expect(screen.getByLabelText("导出名")).toHaveValue("questions-2026-06-13-2");

    await user.click(screen.getByRole("button", { name: "打开文件位置" }));
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/exports/reveal",
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  it("keeps a manually edited export name after success", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("2024-1");
    const nameInput = await screen.findByLabelText("导出名");
    await user.clear(nameInput);
    await user.type(nameInput, "custom-set");

    await user.click(screen.getByRole("button", { name: /导出 2 题/ }));
    await screen.findByText(/导出完成/);
    expect(nameInput).toHaveValue("custom-set");
    const exportCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url) === "/api/export");
    expect(JSON.parse(String(exportCall?.[1]?.body))).toMatchObject({ fileName: "custom-set" });
  });

  it("saves before switching workspaces", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("2024-1");

    const sourceInput = screen.getByDisplayValue("2024-1");
    await user.clear(sourceInput);
    await user.type(sourceInput, "切换前修改");
    await user.click(screen.getByRole("button", { name: "题库设置" }));
    await user.click(screen.getByRole("button", { name: /other-bank/ }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/workspaces/switch",
        expect.objectContaining({
          method: "POST"
        })
      );
    });
    expect(screen.getByRole("heading", { name: "题库设置" })).toBeInTheDocument();

    const calls = vi.mocked(fetch).mock.calls;
    const saveIndex = calls.findIndex(([url, init]) => String(url) === "/api/bank" && init?.method === "PUT");
    const switchIndex = calls.findIndex(([url]) => String(url) === "/api/workspaces/switch");
    expect(saveIndex).toBeGreaterThan(-1);
    expect(switchIndex).toBeGreaterThan(saveIndex);
  });

  it("does not rewrite a clean bank when switching workspaces", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("2024-1");

    await user.click(screen.getByRole("button", { name: "题库设置" }));
    await user.click(screen.getByRole("button", { name: /other-bank/ }));
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/workspaces/switch",
        expect.objectContaining({ method: "POST" })
      );
    });
    expect(
      vi.mocked(fetch).mock.calls.some(
        ([url, init]) => String(url) === "/api/bank" && init?.method === "PUT"
      )
    ).toBe(false);
  });

  it("serializes saves and coalesces edits made during an in-flight request", async () => {
    const user = userEvent.setup();
    let resolveFirstSave: ((response: Response) => void) | undefined;
    const firstSave = new Promise<Response>((resolve) => {
      resolveFirstSave = resolve;
    });
    const saveBodies: Array<{ workspacePath: string; bank: Bank }> = [];

    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input) === "/api/bank" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { workspacePath: string; bank: Bank };
        saveBodies.push(body);
        if (saveBodies.length === 1) return firstSave;
        return json({ workspacePath: body.workspacePath, revision: "revision-3", bank: body.bank });
      }
      return handleFetch(input, init);
    });

    render(<App />);
    await screen.findByText("2024-1");
    const sourceInput = screen.getByDisplayValue("2024-1");
    await user.clear(sourceInput);
    await user.type(sourceInput, "第一次修改");
    await new Promise((resolve) => window.setTimeout(resolve, 650));
    expect(saveBodies).toHaveLength(1);

    await user.clear(sourceInput);
    await user.type(sourceInput, "最终修改");
    await new Promise((resolve) => window.setTimeout(resolve, 650));
    expect(saveBodies).toHaveLength(1);

    resolveFirstSave?.(
      json({
        workspacePath: saveBodies[0].workspacePath,
        revision: "revision-2",
        bank: saveBodies[0].bank
      })
    );
    await waitFor(() => expect(saveBodies).toHaveLength(2));
    expect(saveBodies[1].bank.items[0].sourceNumber).toBe("最终修改");
  });

  it("retains a failed save and retries it on demand", async () => {
    const user = userEvent.setup();
    let saveAttempts = 0;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input) === "/api/bank" && init?.method === "PUT") {
        saveAttempts += 1;
        const body = JSON.parse(String(init.body)) as { workspacePath: string; bank: Bank };
        if (saveAttempts === 1) {
          return json({ error: "题库已被其他程序修改。", code: "BANK_CONFLICT" }, 409);
        }
        return json({ workspacePath: body.workspacePath, revision: "revision-retried", bank: body.bank });
      }
      return handleFetch(input, init);
    });

    render(<App />);
    await screen.findByText("2024-1");
    const sourceInput = screen.getByDisplayValue("2024-1");
    await user.clear(sourceInput);
    await user.type(sourceInput, "等待重试");
    await new Promise((resolve) => window.setTimeout(resolve, 650));

    await user.click(await screen.findByRole("button", { name: "重试保存" }));
    await waitFor(() => expect(saveAttempts).toBe(2));
    expect(await screen.findByText("已保存")).toBeInTheDocument();
  });

  it("shows recovery actions instead of an endless loading screen", async () => {
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/bank" && !init) {
        return json({ error: "bank.json 不是有效的 JSON。", code: "BANK_JSON_INVALID" }, 500);
      }
      if (url === "/api/recovery" && !init) {
        return json({
          candidates: [
            {
              id: "bank.json.bak",
              label: "最近一次保存前的备份",
              createdAt: "2026-01-01T00:00:00.000Z",
              source: "backup"
            }
          ]
        });
      }
      if (url === "/api/recovery" && init?.method === "POST") {
        return json({ workspacePath: "/tmp/latex-bank", revision: "recovered", bank });
      }
      return handleFetch(input, init);
    });

    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText("磁盘数据没有被覆盖")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /最近一次保存前的备份/ }));
    expect(await screen.findByText("2024-1")).toBeInTheDocument();
  });
});

async function handleFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  if (url === "/api/app") return json(appInfo);
  if (url === "/api/bank" && !init) {
    return json({ workspacePath: "/tmp/latex-bank", revision: "revision-1", bank });
  }
  if (url === "/api/bank" && init?.method === "PUT") {
    const request = JSON.parse(String(init.body)) as { workspacePath: string; bank: Bank };
    return json({ workspacePath: request.workspacePath, revision: crypto.randomUUID(), bank: request.bank });
  }
  if (url === "/api/workspaces/switch") {
    return json({
      ...appInfo,
      currentWorkspaceName: "other-bank",
      currentWorkspacePath: "/tmp/other-bank",
      appState: {
        ...appInfo.appState,
        currentWorkspacePath: "/tmp/other-bank"
      }
    });
  }
  if (
    url === "/api/workspaces/create-empty" ||
    url === "/api/workspaces/create-sample" ||
    url === "/api/workspaces/open"
  ) {
    const request = JSON.parse(String(init?.body)) as {
      workspacePath: string;
    };
    const currentWorkspaceName =
      request.workspacePath.split("/").filter(Boolean).at(-1) ?? "bank";
    return json({
      ...appInfo,
      currentWorkspaceName,
      currentWorkspacePath: request.workspacePath,
      appState: {
        ...appInfo.appState,
        currentWorkspacePath: request.workspacePath,
        recentWorkspacePaths: [
          request.workspacePath,
          ...appInfo.appState.recentWorkspacePaths
        ]
      },
      recentWorkspaces: [
        {
          name: currentWorkspaceName,
          path: request.workspacePath,
          exists: true
        },
        ...appInfo.recentWorkspaces
      ]
    });
  }
  if (url === "/api/tex-path") {
    const request = JSON.parse(String(init?.body)) as { texPath?: string };
    return json({
      ...appInfo,
      appState: {
        ...appInfo.appState,
        texPathOverride: request.texPath
      }
    });
  }
  if (url === "/api/assets") {
    return json({
      asset: {
        id: "asset-1",
        fileName: "asset.png",
        originalName: "figure.png",
        relativePath: "assets/asset.png",
        mimeType: "image/png",
        size: 5,
        uploadedAt: "2026-01-01T00:00:00.000Z"
      },
      url: "/assets/asset.png",
      insertText: "\\includegraphics{assets/asset.png}"
    });
  }
  if (url === "/api/compile-item") {
    return compileResponder ? compileResponder() : compileSuccess();
  }
  if (url === "/api/exports/default-name") {
    return json({ exportName: nextExportName });
  }
  if (url === "/api/exports/reveal") {
    return json({ ok: true });
  }
  if (url === "/api/export") {
    const request = JSON.parse(String(init?.body)) as { fileName: string };
    const sequence = /^(questions-\d{4}-\d{2}-\d{2})-(\d+)$/.exec(request.fileName);
    if (sequence) nextExportName = `${sequence[1]}-${Number(sequence[2]) + 1}`;
    return json({
      ok: true,
      exportName: request.fileName,
      exportPath: `/tmp/latex-bank/exports/${request.fileName}`,
      files: ["questions.tex", "questions.pdf", "full.tex", "full.pdf"],
      results: {
        questions: { ok: true, texPath: "questions.tex", pdfPath: "questions.pdf", log: "" },
        full: { ok: true, texPath: "full.tex", pdfPath: "full.pdf", log: "" }
      }
    });
  }
  return json({ error: `Unhandled ${url}` }, 404);
}

function compileSuccess(): Response {
  return json({
    ok: true,
    texPath: "/tmp/current-item.tex",
    pdfPath: "/tmp/current-item.pdf",
    texUrl: "/tmp/current-item.tex",
    pdfUrl: "/tmp/current-item.pdf",
    log: ""
  });
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
