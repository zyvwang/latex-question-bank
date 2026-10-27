import { render, screen, waitFor, within } from "@testing-library/react";
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

function lastSavedBank(): Bank | undefined {
  const saves = vi.mocked(fetch).mock.calls.filter(
    ([url, init]) => String(url) === "/api/bank" && init?.method === "PUT"
  );
  const body = saves.at(-1)?.[1]?.body;
  return body ? (JSON.parse(String(body)) as { bank: Bank }).bank : undefined;
}

function labeledBank() {
  setFixtureBank({
    ...bank,
    items: [
      { ...bank.items[0], topics: ["数列极限"], questionTypes: ["选择"] },
      { ...bank.items[1], topics: ["泰勒公式"], questionTypes: ["解答", "证明"] }
    ]
  });
}

it("lists topics and question type badges in the sidebar row", async () => {
  labeledBank();
  render(<App />);
  const row = (await screen.findByText("2024-1")).closest("button")!;
  expect(within(row).getByText("数列极限")).toBeInTheDocument();
  expect(within(row).getByText("选择")).toBeInTheDocument();
  const second = (await screen.findByText("2024-2")).closest("button")!;
  expect(within(second).getByText("解答")).toBeInTheDocument();
  expect(within(second).getByText("证明")).toBeInTheDocument();
});

it("filters by topic and question type, combining the two with AND", async () => {
  labeledBank();
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText("2024-1");
  expect(screen.queryByLabelText("标签筛选，已选 0 项")).not.toBeInTheDocument();

  const topic = screen.getByLabelText("考点筛选，已选 0 项");
  await user.click(topic);
  await user.click(within(topic.closest("details")!).getByRole("checkbox", { name: "数列极限" }));
  await user.click(within(topic.closest("details")!).getByRole("checkbox", { name: "泰勒公式" }));
  expect(screen.getByText("2024-1")).toBeInTheDocument();
  expect(screen.getByText("2024-2")).toBeInTheDocument();

  const type = screen.getByLabelText("题型筛选，已选 0 项");
  await user.click(type);
  await user.click(within(type.closest("details")!).getByRole("checkbox", { name: "证明" }));
  expect(screen.queryByText("2024-1")).not.toBeInTheDocument();
  expect(screen.getByText("2024-2")).toBeInTheDocument();
});

it("edits topics and question types in separate fields and saves them separately", async () => {
  labeledBank();
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText("2024-1");
  const metadata = screen.getByRole("region", { name: "题目元数据" });
  expect(within(metadata).queryByLabelText("添加标签")).not.toBeInTheDocument();

  await user.type(within(metadata).getByLabelText("添加考点"), "单调有界{Enter}");
  expect(await screen.findByRole("button", { name: "删除考点 单调有界" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "删除题型 选择" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "删除题型 选择" }));
  await user.type(within(metadata).getByLabelText("添加题型"), "填空，证明，");
  expect(screen.queryByRole("button", { name: "删除题型 选择" })).not.toBeInTheDocument();

  await waitFor(() => {
    const saved = lastSavedBank()?.items.find((item) => item.id === "limit");
    expect(saved).toMatchObject({
      topics: ["数列极限", "单调有界"],
      questionTypes: ["填空", "证明"]
    });
  }, { timeout: 2000 });
});
