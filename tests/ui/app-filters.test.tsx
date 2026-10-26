import { render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";



import { userEvent } from "@testing-library/user-event";
import App from "../../src/App.js";
import { setupAppFixture } from "../fixtures/app-ui.js";
vi.mock("../../src/components/LatexEditor.js", () => ({
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea aria-label="latex-editor" value={value} onChange={(event) => onChange(event.target.value)} />
  )
}));


setupAppFixture();

it("combines multi-value review filters with OR inside fields and AND across fields", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("2024-1");

    const prioritySummary = screen.getByLabelText("复习优先级筛选，已选 0 项");
    await user.click(prioritySummary);
    const priorityMenu = prioritySummary.closest("details");
    expect(priorityMenu).not.toBeNull();
    await user.click(within(priorityMenu!).getByRole("checkbox", { name: "必须看" }));
    expect(screen.getByText("2024-1")).toBeInTheDocument();
    expect(screen.queryByText("2024-2")).not.toBeInTheDocument();

    const statusSummary = screen.getByLabelText("审阅状态筛选，已选 0 项");
    await user.click(statusSummary);
    const statusMenu = statusSummary.closest("details");
    expect(statusMenu).not.toBeNull();
    await user.click(within(statusMenu!).getByRole("checkbox", { name: "待审阅" }));
    expect(screen.getByText("当前筛选没有匹配题目。")).toBeInTheDocument();

    await user.click(within(statusMenu!).getByRole("checkbox", { name: "待审阅" }));
    await user.click(within(statusMenu!).getByRole("checkbox", { name: "已审阅" }));
    expect(screen.getByText("2024-1")).toBeInTheDocument();
    expect(screen.queryByText("2024-2")).not.toBeInTheDocument();

    await user.click(within(statusMenu!).getByRole("checkbox", { name: "已审阅" }));
    await user.click(within(priorityMenu!).getByRole("checkbox", { name: "不用看" }));
    expect(screen.getByText("2024-1")).toBeInTheDocument();
    expect(screen.getByText("2024-2")).toBeInTheDocument();

    const bookSummary = screen.getByLabelText("书目筛选，已选 0 项");
    await user.click(bookSummary);
    const bookMenu = bookSummary.closest("details");
    expect(bookMenu).not.toBeNull();
    await user.click(within(bookMenu!).getByRole("checkbox", { name: "未关联书目" }));
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
    expect(screen.getByRole("heading", { name: "高等数学/极限" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "线性代数/矩阵" })).not.toBeInTheDocument();
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
