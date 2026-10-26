import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import App from "../../src/App.js";
import { setupAppFixture } from "../fixtures/app-ui.js";

vi.mock("../../src/components/LatexEditor.js", () => ({
  default: ({ value }: { value: string }) => (
    <textarea aria-label="latex-editor" readOnly value={value} />
  )
}));

setupAppFixture();

it("reviews an agent-imported item and returns to an empty pending state", async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText("2024-1");

  const navigation = screen.getByRole("navigation", { name: "题库页面" });
  await user.click(
    within(navigation).getByRole("button", { name: /待审阅/ })
  );

  expect(await screen.findByText("待审阅 1 道")).toBeInTheDocument();
  expect(screen.getByLabelText("latex-editor")).toHaveValue("求矩阵秩。");

  await user.click(screen.getByRole("button", { name: "批准并下一题" }));

  expect(await screen.findByText("没有待审阅题目")).toBeInTheDocument();
  expect(
    within(navigation).getByRole("button", { name: "待审阅" })
  ).toBeInTheDocument();
  expect(screen.queryByText("待审阅 1 道")).not.toBeInTheDocument();
});

it("bulk-approves the current pending filter after confirmation", async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText("2024-1");
  const navigation = screen.getByRole("navigation", { name: "题库页面" });
  await user.click(
    within(navigation).getByRole("button", { name: /待审阅/ })
  );
  await screen.findByText("待审阅 1 道");

  await user.click(
    screen.getByRole("button", { name: "批准当前筛选" })
  );
  expect(await screen.findByText("没有待审阅题目")).toBeInTheDocument();
});
