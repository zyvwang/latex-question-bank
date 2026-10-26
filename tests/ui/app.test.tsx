import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";


import { appInfo, handleFetch, json } from "../fixtures/app-ui.js";
import { userEvent } from "@testing-library/user-event";
import App from "../../src/App.js";
import { setupAppFixture } from "../fixtures/app-ui.js";
vi.mock("../../src/components/LatexEditor.js", () => ({
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea aria-label="latex-editor" value={value} onChange={(event) => onChange(event.target.value)} />
  )
}));


setupAppFixture();

it("shows startup errors on every failed retry and recovers", async () => {
    let attempts = 0;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input) === "/api/app" && ++attempts < 3) {
        return json({ error: "应用信息暂时不可用" }, 500);
      }
      return handleFetch(input, init);
    });
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText("应用信息加载失败")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("应用信息加载失败")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("2024-1")).toBeInTheDocument();
    expect(attempts).toBe(3);
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
