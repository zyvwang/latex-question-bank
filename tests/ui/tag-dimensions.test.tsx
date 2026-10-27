import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import App from "../../src/App.js";
import { bank, setFixtureBank, setupAppFixture } from "../fixtures/app-ui.js";

vi.mock("../../src/components/LatexEditor.js", () => ({
  default: ({ value }: { value: string }) => (
    <textarea aria-label="latex-editor" readOnly value={value} />
  )
}));

setupAppFixture();

function dimensionBank() {
  setFixtureBank({
    ...bank,
    items: [
      { ...bank.items[0], tags: ["考点·数列极限", "题型·选择", "考法·夹逼准则", "杂项"] },
      { ...bank.items[1], tags: ["考点·泰勒公式", "题型·解答"] }
    ]
  });
}

it("lists topics and a type badge in the sidebar row and hides method tags", async () => {
  dimensionBank();
  render(<App />);
  const row = (await screen.findByText("2024-1")).closest("button")!;
  expect(within(row).getByText("数列极限")).toBeInTheDocument();
  expect(within(row).getByText("杂项")).toBeInTheDocument();
  expect(within(row).getByText("选择")).toBeInTheDocument();
  expect(within(row).queryByText("夹逼准则")).not.toBeInTheDocument();
  expect(within(row).queryByText("考点·数列极限")).not.toBeInTheDocument();
});

it("splits the tag filter into dimensions that combine with AND", async () => {
  dimensionBank();
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText("2024-1");
  expect(screen.queryByLabelText("标签筛选，已选 0 项")).toBeInTheDocument();

  const topic = screen.getByLabelText("考点筛选，已选 0 项");
  await user.click(topic);
  await user.click(within(topic.closest("details")!).getByRole("checkbox", { name: "数列极限" }));
  await user.click(within(topic.closest("details")!).getByRole("checkbox", { name: "泰勒公式" }));
  expect(screen.getByText("2024-1")).toBeInTheDocument();
  expect(screen.getByText("2024-2")).toBeInTheDocument();

  const type = screen.getByLabelText("题型筛选，已选 0 项");
  await user.click(type);
  await user.click(within(type.closest("details")!).getByRole("checkbox", { name: "解答" }));
  expect(screen.queryByText("2024-1")).not.toBeInTheDocument();
  expect(screen.getByText("2024-2")).toBeInTheDocument();
});

it("edits each dimension in its own field and adds the prefix automatically", async () => {
  dimensionBank();
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText("2024-1");

  expect(screen.getByRole("button", { name: "删除标签 考点·数列极限" })).toBeInTheDocument();
  const topicInput = screen.getByLabelText("添加考点");
  await user.type(topicInput, "单调有界{Enter}");
  expect(await screen.findByRole("button", { name: "删除标签 考点·单调有界" })).toBeInTheDocument();
  // 其他维度的标签原样保留
  expect(screen.getByRole("button", { name: "删除标签 题型·选择" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "删除标签 杂项" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "删除标签 题型·选择" }));
  expect(screen.queryByRole("button", { name: "删除标签 题型·选择" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "删除标签 考点·单调有界" })).toBeInTheDocument();
});
