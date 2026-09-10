import { render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { Bank } from "../../shared/types.js";
import type { UiLayoutPreferences } from "../../shared/ui-layout-preferences.js";
import { bank, handleFetch, json } from "../fixtures/app-ui.js";
import { userEvent } from "@testing-library/user-event";
import App from "../../src/App.js";
import { setupAppFixture } from "../fixtures/app-ui.js";
vi.mock("../../src/components/LatexEditor.js", () => ({
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea aria-label="latex-editor" value={value} onChange={(event) => onChange(event.target.value)} />
  )
}));


setupAppFixture();

it("restores, adjusts, and collapses editor panes with the keyboard", async () => {
    const saveUiLayoutPreferences = vi.fn().mockResolvedValue(undefined);
    window.lqb = {
      platform: "darwin",
      selectWorkspaceDirectory: vi.fn().mockResolvedValue(null),
      openPath: vi.fn().mockResolvedValue(""),
      revealExportFolder: vi.fn().mockResolvedValue(true),
      openExternal: vi.fn().mockResolvedValue(true),
      onBeforeClose: vi.fn(() => () => undefined),
      readUiLayoutPreferences: vi.fn().mockResolvedValue({
        questionSidebarWidth: 320,
        questionSidebarCollapsed: false,
        moduleEditorPercent: 58,
        heatmapPreviewWidth: 460,
        heatmapPreviewCollapsed: false
      }),
      saveUiLayoutPreferences
    };
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("2024-1");

    const sidebarSeparator = screen.getByRole("separator", {
      name: "调整题目侧栏宽度"
    });
    await waitFor(() => expect(sidebarSeparator).toHaveAttribute("aria-valuenow", "320"));
    expect(sidebarSeparator).toHaveAttribute("aria-valuemin", "240");
    expect(sidebarSeparator).toHaveAttribute("aria-valuemax", "360");
    sidebarSeparator.focus();
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(sidebarSeparator).toHaveAttribute("aria-valuenow", "328"));

    await user.click(screen.getByRole("button", { name: "收起题目侧栏" }));
    expect(screen.getByRole("button", { name: "展开题目侧栏" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "展开题目侧栏" }));

    const moduleSeparator = screen.getByRole("separator", {
      name: "调整代码与预览比例"
    });
    expect(moduleSeparator).toHaveAttribute("aria-valuenow", "58");
    moduleSeparator.focus();
    await user.keyboard("{Home}");
    expect(moduleSeparator).toHaveAttribute("aria-valuenow", "35");

    await waitFor(() => expect(saveUiLayoutPreferences).toHaveBeenCalled());
    expect(saveUiLayoutPreferences).toHaveBeenLastCalledWith(expect.objectContaining({
      questionSidebarWidth: 328,
      questionSidebarCollapsed: false,
      moduleEditorPercent: 35
    }));
  });

it("keeps an early pane adjustment while desktop preferences are still loading", async () => {
    let resolvePreferences!: (preferences: UiLayoutPreferences) => void;
    const saveUiLayoutPreferences = vi.fn().mockResolvedValue(undefined);
    window.lqb = {
      platform: "darwin",
      selectWorkspaceDirectory: vi.fn().mockResolvedValue(null),
      openPath: vi.fn().mockResolvedValue(""),
      revealExportFolder: vi.fn().mockResolvedValue(true),
      openExternal: vi.fn().mockResolvedValue(true),
      onBeforeClose: vi.fn(() => () => undefined),
      readUiLayoutPreferences: vi.fn(() => new Promise<UiLayoutPreferences>((resolve) => {
        resolvePreferences = resolve;
      })),
      saveUiLayoutPreferences
    };
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("2024-1");

    const separator = screen.getByRole("separator", {
      name: "调整题目侧栏宽度"
    });
    separator.focus();
    await user.keyboard("{End}");
    expect(separator).toHaveAttribute("aria-valuenow", "360");

    resolvePreferences({
      questionSidebarWidth: 240,
      questionSidebarCollapsed: false,
      moduleEditorPercent: 50,
      heatmapPreviewWidth: 380,
      heatmapPreviewCollapsed: false
    });
    await waitFor(() => expect(separator).toHaveAttribute("aria-valuenow", "360"));
    await waitFor(() => expect(saveUiLayoutPreferences).toHaveBeenLastCalledWith(
      expect.objectContaining({ questionSidebarWidth: 360 })
    ));
  });

it("shows chapter headings and keeps review marks and tags on question rows", async () => {
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
    expect(within(first!).queryByText("高等数学/极限")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "高等数学/极限" })).toBeInTheDocument();
    expect(within(first!).getByText("极限")).toBeInTheDocument();
    expect(within(first!).getByText(
      "含参数的分段函数连续性分类讨论"
    )).toBeInTheDocument();

    const second = document.getElementById("question-nav-matrix");
    expect(second).not.toBeNull();
    expect(within(second!).getByLabelText(
      "掌握程度：未设置；错误原因：未设置"
    )).toBeInTheDocument();
    expect(within(second!).queryByText("未分类")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "未分类" })).toBeInTheDocument();
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
