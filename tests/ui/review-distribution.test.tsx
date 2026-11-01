import { render, screen, within } from "@testing-library/react";
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

const nav = () => within(screen.getByRole("navigation", { name: "题库页面" }));

async function openDistribution() {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText("2024-1");
  await user.click(nav().getByRole("button", { name: "复习分布" }));
  await screen.findByRole("heading", { name: "复习分布" });
  return user;
}

it("shows totals, status counts, and chapter rows with uncategorized last", async () => {
  setFixtureBank(distributionBank());
  await openDistribution();

  expect(screen.getByText("共 4 题，已标记 3 题（75%）")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: /必须看 1 题，占 25%/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "未标记 1 题，在题库中查看" })).toBeInTheDocument();
  const rows = within(screen.getByRole("table")).getAllByRole("rowheader").map((cell) => cell.textContent);
  expect(rows).toEqual(["高等数学/极限", "线性代数/矩阵", "未分类"]);
  const first = within(screen.getByRole("table")).getAllByRole("row")[1]!;
  expect(within(first).getAllByRole("cell").map((cell) => cell.textContent).slice(1)).toEqual(["1", "1", "0", "0", "100%"]);
});

it("jumps to the editor with a status applied as the sidebar filter", async () => {
  setFixtureBank(distributionBank());
  const user = await openDistribution();

  await user.click(screen.getByRole("button", { name: "未标记 1 题，在题库中查看" }));

  await screen.findByLabelText("复习优先级筛选，已选 1 项");
  expect(screen.queryByText("2024-1")).not.toBeInTheDocument();
  expect(screen.getByLabelText("来源题号")).toHaveValue("");
});

it("expands a chapter to show questions and opens one in the editor", async () => {
  setFixtureBank(distributionBank());
  const user = await openDistribution();
  const chapter = screen.getByRole("button", { name: "高等数学/极限" });
  expect(screen.queryByRole("button", { name: /2024-3，再看看/ })).not.toBeInTheDocument();

  await user.click(chapter);
  expect(chapter).toHaveAttribute("aria-expanded", "true");
  await user.click(screen.getByRole("button", { name: /2024-3，再看看/ }));

  expect(await screen.findByLabelText("来源题号")).toHaveValue("2024-3");
  expect(nav().getByRole("button", { name: "编辑" })).toHaveAttribute("aria-current", "page");
});

it("lists must-review questions and opens them", async () => {
  setFixtureBank(distributionBank());
  const user = await openDistribution();
  const list = screen.getByRole("complementary", { name: "必须看清单" });

  await user.click(within(list).getByRole("button", { name: /2024-1/ }));

  expect(await screen.findByLabelText("来源题号")).toHaveValue("2024-1");
});

it("clears sidebar filters only when they would hide the opened question", async () => {
  setFixtureBank(distributionBank());
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText("2024-1");
  const summary = screen.getByLabelText("复习优先级筛选，已选 0 项");
  await user.click(summary);
  await user.click(within(summary.closest("details")!).getByRole("checkbox", { name: "再看看" }));

  await user.click(nav().getByRole("button", { name: "复习分布" }));
  await user.click(await within(screen.getByRole("complementary", { name: "必须看清单" })).findByRole("button", { name: /2024-1/ }));
  expect(await screen.findByLabelText("复习优先级筛选，已选 0 项")).toBeInTheDocument();

  const reopened = screen.getByLabelText("复习优先级筛选，已选 0 项");
  await user.click(reopened);
  await user.click(within(reopened.closest("details")!).getByRole("checkbox", { name: "必须看" }));
  await user.click(nav().getByRole("button", { name: "复习分布" }));
  await user.click(await within(screen.getByRole("complementary", { name: "必须看清单" })).findByRole("button", { name: /2024-1/ }));
  expect(await screen.findByLabelText("复习优先级筛选，已选 1 项")).toBeInTheDocument();
});

it("keeps expanded chapters when returning from the editor", async () => {
  setFixtureBank(distributionBank());
  const user = await openDistribution();
  await user.click(screen.getByRole("button", { name: "高等数学/极限" }));
  await user.click(screen.getByRole("button", { name: /2024-3，再看看/ }));
  await screen.findByLabelText("来源题号");

  await user.click(nav().getByRole("button", { name: "复习分布" }));

  expect(await screen.findByRole("button", { name: "高等数学/极限" })).toHaveAttribute("aria-expanded", "true");
});

it("reflects a priority edited in the editor", async () => {
  setFixtureBank(distributionBank());
  const user = await openDistribution();
  await user.click(within(screen.getByRole("complementary", { name: "必须看清单" })).getByRole("button", { name: /2024-1/ }));

  const field = await screen.findByRole("group", { name: "复习优先级" });
  await user.click(within(field).getByRole("button", { name: "不用看" }));
  await user.click(nav().getByRole("button", { name: "复习分布" }));

  expect(await screen.findByRole("button", { name: "不用看 2 题，在题库中查看" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "必须看 0 题，在题库中查看" })).toBeDisabled();
  expect(screen.getByText("还没有标记为必须看的题。")).toBeInTheDocument();
});

it("shows an empty state that returns to the editor", async () => {
  setFixtureBank({ ...bank, items: [] });
  const user = userEvent.setup();
  render(<App />);
  await user.click(await within(await screen.findByRole("navigation", { name: "题库页面" })).findByRole("button", { name: "复习分布" }));

  expect(await screen.findByRole("heading", { name: "题库还没有题目" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "返回编辑" }));
  expect(nav().getByRole("button", { name: "编辑" })).toHaveAttribute("aria-current", "page");
});
