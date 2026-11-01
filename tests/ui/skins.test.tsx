import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import App from "../../src/App.js";
import { BUILTIN_SKINS } from "../../shared/builtin-skins.js";
import { handleFetch, setupAppFixture } from "../fixtures/app-ui.js";

vi.mock("../../src/components/LatexEditor.js", () => ({
  default: ({ value }: { value: string }) => <textarea aria-label="latex-editor" readOnly value={value} />
}));

setupAppFixture();

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("style");
});

async function openSettings() {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText("2024-1");
  await user.click(
    within(screen.getByRole("navigation", { name: "题库页面" })).getByRole("button", { name: "题库设置" })
  );
  return user;
}

it("applies the default skin to the document", async () => {
  render(<App />);
  await screen.findByText("2024-1");
  expect(document.documentElement.dataset.skin).toBe("sheet");
  expect(document.documentElement.dataset.nav).toBe("rail");
  expect(document.documentElement.style.getPropertyValue("--border-strong")).toBe(
    BUILTIN_SKINS[0]!.tokens.borderStrong
  );
});

it("switches skins from settings and persists the choice", async () => {
  const user = await openSettings();
  await user.click(
    within(await screen.findByRole("group", { name: "浅色时使用" })).getByRole("button", { name: "瓷白" })
  );
  expect(document.documentElement.dataset.skin).toBe("porcelain");
  expect(document.documentElement.dataset.nav).toBe("top");

  await user.click(within(screen.getByRole("group", { name: "明暗模式" })).getByRole("button", { name: "深色" }));
  expect(document.documentElement.dataset.skin).toBe("darkroom");
  expect(document.documentElement.style.colorScheme).toBe("dark");
});

it("keeps built-in skins and reports unreadable files when the list has errors", async () => {
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    if (String(input) === "/api/skins") {
      return new Response(JSON.stringify({
        skins: BUILTIN_SKINS,
        errors: [{ file: "bad.json", field: "tokens", code: "SKIN_TOKENS", message: "tokens: 提供全部颜色 token。" }]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return handleFetch(input, init);
  });
  await openSettings();
  expect(await screen.findByRole("alert", { name: "无法读取的皮肤" })).toHaveTextContent("提供全部颜色 token");
  expect(document.documentElement.dataset.skin).toBe("sheet");
});

it("falls back to the default when the saved skin no longer exists", async () => {
  window.localStorage.setItem("latex-question-bank.ui-layout.v1", JSON.stringify({ lightSkinId: "gone" }));
  render(<App />);
  await screen.findByText("2024-1");
  await waitFor(() => expect(document.documentElement.dataset.skin).toBe("sheet"));
});

it("opens the command palette, filters, and runs a page command", async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText("2024-1");

  await user.keyboard("{Control>}k{/Control}");
  const input = await screen.findByLabelText("搜索题目或命令");
  await user.type(input, "复习");
  await user.keyboard("{Enter}");

  expect(await screen.findByRole("heading", { name: "复习分布" })).toBeInTheDocument();
  expect(screen.queryByRole("dialog", { name: "命令面板" })).not.toBeInTheDocument();
});

it("jumps to a question from the palette and closes on Escape", async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText("2024-1");

  await user.keyboard("{Control>}k{/Control}");
  await user.type(await screen.findByLabelText("搜索题目或命令"), "没有这个");
  expect(screen.getByText("没有匹配的题目或命令。")).toBeInTheDocument();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "命令面板" })).not.toBeInTheDocument();

  await user.keyboard("{Control>}k{/Control}");
  await user.type(await screen.findByLabelText("搜索题目或命令"), "2024-2");
  await user.keyboard("{ArrowDown}{ArrowUp}{Enter}");
  expect(await screen.findByLabelText("来源题号")).toHaveValue("2024-2");
});
