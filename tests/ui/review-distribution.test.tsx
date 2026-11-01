import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import App from "../../src/App.js";
import type { Bank } from "../../shared/types.js";
import { bank, setFixtureBank, setupAppFixture } from "../fixtures/app-ui.js";

vi.mock("../../src/components/LatexEditor.js", () => ({
  default: ({ value }: { value: string }) => (
    <textarea aria-label="latex-editor" readOnly value={value} />
  )
}));

setupAppFixture();

// 三种状态各一题，另有一题未分类且未标记。
function distributionBank(): Bank {
  const [limit, matrix] = bank.items;
  return {
    ...bank,
    items: [
      limit,
      matrix,
      {
        ...limit,
        id: "series",
        source: { bookId: null, label: "2024-3" },
        chapterOrder: 2,
        reviewPriority: "recheck",
        modules: { ...limit.modules, question: { tex: "判断级数敛散性。" } }
      },
      {
        ...limit,
        id: "loose",
        source: null,
        chapterId: null,
        chapterOrder: 1,
        reviewPriority: null,
        modules: { ...limit.modules, question: { tex: "未分类题。" } }
      }
    ]
  };
}

async function openDistribution() {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText("2024-1");
  await user.click(
    within(screen.getByRole("navigation", { name: "题库页面" })).getByRole("button", {
      name: "复习分布"
    })
  );
  await screen.findByRole("heading", { name: "复习分布" });
  return user;
}

const statusButton = (name: RegExp) =>
  within(screen.getByRole("group", { name: "按状态突出显示" })).getByRole("button", { name });

const cell = (name: RegExp) => screen.getByRole("button", { name });

it("shows totals, per-status counts, and groups chapters with uncategorized last", async () => {
  setFixtureBank(distributionBank());
  await openDistribution();

  expect(screen.getByText("共 4 道 · 已标记 3 道（75%）")).toBeInTheDocument();
  expect(statusButton(/必须看/)).toHaveTextContent("125%");
  expect(statusButton(/未标记/)).toHaveTextContent("125%");
  expect(screen.getByRole("img", { name: /必须看 1 道，占 25%/ })).toBeInTheDocument();
  const headings = within(screen.getByRole("region", { name: "各章题目分布" }))
    .getAllByRole("heading", { level: 2 })
    .map((heading) => heading.textContent);
  expect(headings).toEqual(["高等数学/极限", "线性代数/矩阵", "未分类"]);
  expect(cell(/章内第 2 题，来源 2024-3，复习优先级 再看看/)).toHaveAttribute(
    "data-status",
    "recheck"
  );
  expect(cell(/来源 未设置，复习优先级 未标记/)).toHaveAttribute("data-status", "unset");
});

it("toggles a single highlighted status and offers the matching editor list", async () => {
  setFixtureBank(distributionBank());
  const user = await openDistribution();
  const grid = screen.getByRole("region", { name: "各章题目分布" }).firstElementChild!;

  await user.click(statusButton(/再看看/));
  expect(statusButton(/再看看/)).toHaveAttribute("aria-pressed", "true");
  expect(grid).toHaveAttribute("data-highlight", "recheck");

  await user.click(statusButton(/不用看/));
  expect(statusButton(/再看看/)).toHaveAttribute("aria-pressed", "false");
  expect(grid).toHaveAttribute("data-highlight", "skip");

  await user.click(statusButton(/不用看/));
  expect(grid).not.toHaveAttribute("data-highlight");
  expect(screen.queryByRole("button", { name: /在编辑页查看/ })).not.toBeInTheDocument();
});

it("jumps to the editor with the highlighted status applied as the sidebar filter", async () => {
  setFixtureBank(distributionBank());
  const user = await openDistribution();

  await user.click(statusButton(/未标记/));
  await user.click(screen.getByRole("button", { name: "在编辑页查看 1 道" }));

  await screen.findByLabelText("复习优先级筛选，已选 1 项");
  expect(screen.queryByText("2024-1")).not.toBeInTheDocument();
  expect(screen.getByLabelText("来源题号")).toHaveValue("");
});

it("opens a clicked question in the editor", async () => {
  setFixtureBank(distributionBank());
  const user = await openDistribution();

  await user.click(cell(/来源 2024-3/));

  expect(await screen.findByLabelText("来源题号")).toHaveValue("2024-3");
  expect(
    within(screen.getByRole("navigation", { name: "题库页面" })).getByRole("button", {
      name: "编辑"
    })
  ).toHaveAttribute("aria-current", "page");
});

it("clears sidebar filters when they would hide the opened question", async () => {
  setFixtureBank(distributionBank());
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText("2024-1");
  const summary = screen.getByLabelText("复习优先级筛选，已选 0 项");
  await user.click(summary);
  await user.click(
    within(summary.closest("details")!).getByRole("checkbox", { name: "必须看" })
  );
  expect(screen.queryByText("2024-2")).not.toBeInTheDocument();

  await user.click(
    within(screen.getByRole("navigation", { name: "题库页面" })).getByRole("button", {
      name: "复习分布"
    })
  );
  await user.click(await screen.findByRole("button", { name: /来源 2024-2/ }));

  expect(await screen.findByLabelText("复习优先级筛选，已选 0 项")).toBeInTheDocument();
  expect(screen.getByText("2024-2")).toBeInTheDocument();
});

it("keeps sidebar filters when the opened question is already visible", async () => {
  setFixtureBank(distributionBank());
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText("2024-1");
  const summary = screen.getByLabelText("复习优先级筛选，已选 0 项");
  await user.click(summary);
  await user.click(
    within(summary.closest("details")!).getByRole("checkbox", { name: "必须看" })
  );

  await user.click(
    within(screen.getByRole("navigation", { name: "题库页面" })).getByRole("button", {
      name: "复习分布"
    })
  );
  await user.click(await screen.findByRole("button", { name: /来源 2024-1/ }));

  expect(await screen.findByLabelText("复习优先级筛选，已选 1 项")).toBeInTheDocument();
});

it("debounces hover preview and renders a single preview", async () => {
  setFixtureBank(distributionBank());
  await openDistribution();
  const preview = screen.getByRole("complementary", { name: "题目预览" });
  expect(within(preview).getByRole("heading", { level: 2 })).toHaveTextContent("2024-1");

  const target = cell(/来源 2024-3/);
  fireEvent.mouseEnter(target);
  expect(within(preview).getByRole("heading", { level: 2 })).toHaveTextContent("2024-1");
  await waitFor(() =>
    expect(within(preview).getByRole("heading", { level: 2 })).toHaveTextContent("2024-3")
  );
  expect(screen.getAllByRole("complementary", { name: "题目预览" })).toHaveLength(1);
});

it("drops a pending preview when the pointer leaves before the delay", async () => {
  setFixtureBank(distributionBank());
  await openDistribution();
  const preview = screen.getByRole("complementary", { name: "题目预览" });
  const target = cell(/来源 2024-3/);

  fireEvent.mouseEnter(target);
  fireEvent.mouseLeave(target);
  await new Promise((resolve) => window.setTimeout(resolve, 260));

  expect(within(preview).getByRole("heading", { level: 2 })).toHaveTextContent("2024-1");
});

it("supports roving keyboard navigation and Enter to open", async () => {
  setFixtureBank(distributionBank());
  const user = await openDistribution();
  const first = cell(/来源 2024-1/);
  expect(first).toHaveAttribute("tabindex", "0");
  expect(cell(/来源 2024-3/)).toHaveAttribute("tabindex", "-1");

  first.focus();
  await user.keyboard("{ArrowRight}");
  expect(cell(/来源 2024-3/)).toHaveFocus();
  expect(cell(/来源 2024-3/)).toHaveAttribute("tabindex", "0");

  await user.keyboard("{Enter}");
  expect(await screen.findByLabelText("来源题号")).toHaveValue("2024-3");
});

it("restores the highlight and focused cell when returning from the editor", async () => {
  setFixtureBank(distributionBank());
  const user = await openDistribution();
  await user.click(statusButton(/再看看/));
  await user.click(cell(/来源 2024-3/));
  await screen.findByLabelText("来源题号");

  await user.click(
    within(screen.getByRole("navigation", { name: "题库页面" })).getByRole("button", {
      name: "复习分布"
    })
  );

  await screen.findByRole("heading", { name: "复习分布" });
  expect(statusButton(/再看看/)).toHaveAttribute("aria-pressed", "true");
  expect(cell(/来源 2024-3/)).toHaveFocus();
});

it("reflects a priority edited in the editor", async () => {
  setFixtureBank(distributionBank());
  const user = await openDistribution();
  await user.click(cell(/来源 2024-1/));

  const field = await screen.findByRole("group", { name: "复习优先级" });
  await user.click(within(field).getByRole("button", { name: "不用看" }));
  await user.click(
    within(screen.getByRole("navigation", { name: "题库页面" })).getByRole("button", {
      name: "复习分布"
    })
  );

  await screen.findByRole("heading", { name: "复习分布" });
  expect(statusButton(/必须看/)).toHaveTextContent("00%");
  expect(statusButton(/不用看/)).toHaveTextContent("250%");
  expect(cell(/来源 2024-1/)).toHaveAttribute("data-status", "skip");
});

it("shows an empty state that returns to the editor", async () => {
  setFixtureBank({ ...bank, items: [] });
  const user = userEvent.setup();
  render(<App />);
  await user.click(
    await within(await screen.findByRole("navigation", { name: "题库页面" })).findByRole(
      "button",
      { name: "复习分布" }
    )
  );

  expect(await screen.findByRole("heading", { name: "题库还没有题目" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "返回编辑" }));
  expect(
    within(screen.getByRole("navigation", { name: "题库页面" })).getByRole("button", {
      name: "编辑"
    })
  ).toHaveAttribute("aria-current", "page");
});
