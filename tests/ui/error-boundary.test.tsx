import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppErrorBoundary } from "../../src/components/AppErrorBoundary.js";

function Boom(): never {
  throw new Error("题库渲染炸了");
}

describe("app error boundary", () => {
  beforeEach(() => {
    // React 会把被边界捕获的异常再打一遍到 console.error,静音以免污染输出。
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders children while nothing throws", () => {
    render(
      <AppErrorBoundary>
        <p>正常内容</p>
      </AppErrorBoundary>
    );
    expect(screen.getByText("正常内容")).toBeInTheDocument();
  });

  it("shows a recoverable fallback instead of unmounting the tree", () => {
    render(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>
    );

    expect(
      screen.getByRole("heading", { name: "已停止渲染以避免继续出错" })
    ).toBeInTheDocument();
    expect(screen.getByText("题库渲染炸了")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "重新加载" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/磁盘上的 bank.json 没有被这次异常改动/)
    ).toBeInTheDocument();
    expect(console.error).toHaveBeenCalled();
  });
});
