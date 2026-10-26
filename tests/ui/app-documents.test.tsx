import { render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";


import { handleFetch, json, compileSuccess, fixtureState } from "../fixtures/app-ui.js";
import { userEvent } from "@testing-library/user-event";
import App from "../../src/App.js";
import { setupAppFixture } from "../fixtures/app-ui.js";
vi.mock("../../src/components/LatexEditor.js", () => ({
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea aria-label="latex-editor" value={value} onChange={(event) => onChange(event.target.value)} />
  )
}));


setupAppFixture();

it("binds compile success to the checked item and exact content version", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("2024-1");

    await user.click(screen.getByRole("button", { name: "检查当前题" }));
    const successText = await screen.findByText("当前题编译通过。");
    expect(within(successText.parentElement!).getByRole("button", { name: "打开" })).toBeInTheDocument();

    await user.click(screen.getByText("2024-2"));
    expect(await screen.findByText("编译结果已过期，请重新检查。")).toBeInTheDocument();
    await user.click(screen.getByText("2024-1"));
    expect(await screen.findByText("当前题编译通过。")).toBeInTheDocument();

    const editor = screen.getByLabelText("latex-editor");
    await user.type(editor, "修改");
    const staleText = await screen.findByText("编译结果已过期，请重新检查。");
    expect(within(staleText.parentElement!).queryByRole("button", { name: "打开" })).not.toBeInTheDocument();
  });

it("does not invoke TeX when the workspace trust prompt is declined", async () => {
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("2024-1");

    await user.click(screen.getByRole("button", { name: "检查当前题" }));

    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("请仅编译或导出你信任的工作区内容")
    );
    expect(
      vi.mocked(fetch).mock.calls.some(
        ([url]) => String(url) === "/api/compile-item"
      )
    ).toBe(false);
  });

it("marks an in-flight compile stale when content changes", async () => {
    const user = userEvent.setup();
    let resolveCompile: ((response: Response) => void) | undefined;
    fixtureState.compileResponder = () => new Promise<Response>((resolve) => {
      resolveCompile = resolve;
    });
    render(<App />);
    await screen.findByText("2024-1");

    await user.click(screen.getByRole("button", { name: "检查当前题" }));
    expect(await screen.findByText("正在编译当前题。")).toBeInTheDocument();
    await user.type(screen.getByLabelText("latex-editor"), "修改");
    expect(await screen.findByText("编译内容已变化，完成后结果将过期。")).toBeInTheDocument();

    resolveCompile?.(compileSuccess());
    expect(await screen.findByText("编译结果已过期，请重新检查。")).toBeInTheDocument();
  });

it("hides a compile failure log after switching items", async () => {
    const user = userEvent.setup();
    fixtureState.compileResponder = async () => json({
      ok: false,
      texPath: "/tmp/current-item.tex",
      texUrl: "/tmp/current-item.tex",
      log: "Undefined control sequence"
    }, 422);
    render(<App />);
    await screen.findByText("2024-1");

    await user.click(screen.getByRole("button", { name: "检查当前题" }));
    expect(await screen.findByText("Undefined control sequence")).toBeInTheDocument();
    await user.click(screen.getByText("2024-2"));
    expect(screen.queryByText("Undefined control sequence")).not.toBeInTheDocument();
    expect(await screen.findByText("编译结果已过期，请重新检查。")).toBeInTheDocument();
  });

it("uploads an image into the active module", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await screen.findByText("2024-1");

    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    await user.upload(input!, new File(["image"], "figure.png", { type: "image/png" }));

    expect(await screen.findByText("图片已插入当前模块。")).toBeInTheDocument();
  });

it("surfaces an error notice and no success when an image upload is rejected", async () => {
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input) === "/api/assets") {
        return json(
          { error: "图片内容不是有效的 PNG 或 JPEG。", code: "IMAGE_SIGNATURE_INVALID" },
          400
        );
      }
      return handleFetch(input, init);
    });
    const user = userEvent.setup();
    const { container } = render(<App />);
    await screen.findByText("2024-1");

    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    await user.upload(input!, new File(["x"], "figure.png", { type: "image/png" }));

    expect(
      await screen.findByText("图片内容不是有效的 PNG 或 JPEG。")
    ).toBeInTheDocument();
    expect(screen.queryByText("图片已插入当前模块。")).not.toBeInTheDocument();
  });

it("appends an uploaded image to the latest module content without overwriting concurrent edits", async () => {
    let resolveUpload: (() => void) | null = null;
    const pendingUpload = new Promise<Response>((resolve) => {
      resolveUpload = () =>
        resolve(
          json({
            asset: {
              id: "asset-9",
              fileName: "asset.png",
              originalName: "figure.png",
              relativePath: "assets/asset.png",
              mimeType: "image/png",
              size: 5,
              uploadedAt: "2026-01-01T00:00:00.000Z"
            },
            url: "/assets/asset.png",
            insertText: "\\CONCURRENTIMG"
          })
        );
    });
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input) === "/api/assets") return pendingUpload;
      return handleFetch(input, init);
    });
    const user = userEvent.setup();
    const { container } = render(<App />);
    await screen.findByText("2024-1");

    const editor = screen.getAllByLabelText("latex-editor")[0] as HTMLTextAreaElement;
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    // 上传请求挂起期间继续编辑题面
    await user.upload(input!, new File(["x"], "figure.png", { type: "image/png" }));
    await user.clear(editor);
    await user.type(editor, "并发编辑内容");
    // 完成上传:应基于最新题面追加图片,而非用上传发起时的旧内容覆盖
    resolveUpload!();

    expect(await screen.findByText("图片已插入当前模块。")).toBeInTheDocument();
    await waitFor(() => {
      expect(editor.value).toContain("并发编辑内容");
      expect(editor.value).toContain("\\CONCURRENTIMG");
    });
  });

it("increments an automatic export name and opens its file location", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("2024-1");
    const nameInput = await screen.findByLabelText("导出名");
    // 导出名只由服务端给出。必须等它落地再断言:findBy* 在元素一出现就 resolve,
    // 直接断言会读到 fetch 前的空值。这里的日期来自 mock 响应,与本机日期无关。
    await waitFor(() => expect(nameInput).toHaveValue("questions-2026-06-13-1"));

    await user.click(screen.getByRole("button", { name: /导出 2 题/ }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/export",
        expect.objectContaining({
          method: "POST"
        })
      );
    });
    expect(await screen.findByText(/导出完成/)).toBeInTheDocument();
    await waitFor(() => expect(nameInput).toHaveValue("questions-2026-06-13-2"));

    await user.click(screen.getByRole("button", { name: "打开文件位置" }));
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/exports/reveal",
        expect.objectContaining({ method: "POST" })
      );
    });
  });

it("keeps a manually edited export name after success", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("2024-1");
    const nameInput = await screen.findByLabelText("导出名");
    // 先等服务端名字落地:对空字段 clear 不会触发 onChange,手动标记不会置位,
    // 随后到达的服务端值就会盖掉用户输入。
    await waitFor(() => expect(nameInput).toHaveValue("questions-2026-06-13-1"));
    await user.clear(nameInput);
    await user.type(nameInput, "custom-set");

    await user.click(screen.getByRole("button", { name: /导出 2 题/ }));
    await screen.findByText(/导出完成/);
    expect(nameInput).toHaveValue("custom-set");
    const exportCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url) === "/api/export");
    expect(JSON.parse(String(exportCall?.[1]?.body))).toMatchObject({ fileName: "custom-set" });
  });

it("falls back to a local export name when the server cannot supply one", async () => {
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input) === "/api/exports/default-name") {
        return json({ error: "服务器内部错误。", code: "INTERNAL_ERROR" }, 500);
      }
      return handleFetch(input, init);
    });
    render(<App />);
    await screen.findByText("2024-1");

    // 服务端拿不到名字时不能把字段留空:空 fileName 会被服务端兜成 export-<date>。
    const nameInput = (await screen.findByLabelText("导出名")) as HTMLInputElement;
    await waitFor(() =>
      expect(nameInput.value).toMatch(/^questions-\d{4}-\d{2}-\d{2}-1$/)
    );
  });
