import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSampleBank } from "../../server/bank-schema.js";
import type { AppInfo, Bank } from "../../shared/types.js";
import App from "../../src/App.js";

vi.mock("../../src/components/LatexEditor.js", () => ({
  default: ({ value }: { value: string }) => (
    <textarea aria-label="latex-editor" readOnly value={value} />
  )
}));

const workspacePath = "/tmp/close-flush-bank";

const appInfo: AppInfo = {
  appState: {
    version: 1,
    currentWorkspacePath: workspacePath,
    recentWorkspacePaths: [workspacePath]
  },
  currentWorkspaceName: "关闭保存测试题库",
  currentWorkspacePath: workspacePath,
  recentWorkspaces: [
    { name: "关闭保存测试题库", path: workspacePath, exists: true }
  ],
  texStatus: {
    available: true,
    command: "latexmk",
    source: "path",
    message: "已检测到 LaTeX：latexmk"
  },
  isDesktop: true,
  setupRequired: false
};

let currentBank: Bank;
let savedBanks: Bank[];
let forceSaveConflict: boolean;
let texPathResponse: Promise<Response> | null;
let texPathResponses: Array<Promise<Response>>;
let savedTexPaths: string[];
/** useBeforeCloseFlush 注册进来的关闭监听器,等同于主进程发 app:before-close。 */
let closeListener: (() => Promise<void>) | null;

beforeEach(() => {
  currentBank = sameChapterBank();
  savedBanks = [];
  forceSaveConflict = false;
  texPathResponse = null;
  texPathResponses = [];
  savedTexPaths = [];
  closeListener = null;
  vi.stubGlobal("fetch", vi.fn(handleFetch));
  window.lqb = {
    platform: "darwin",
    selectWorkspaceDirectory: vi.fn(),
    openPath: vi.fn(),
    revealExportFolder: vi.fn(),
    openExternal: vi.fn(),
    onBeforeClose: (listener) => {
      closeListener = listener;
      return () => {
        closeListener = null;
      };
    }
  };
});

describe("close boundary commits focused drafts", () => {
  it("saves a source number that was typed but never blurred", async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = await screen.findByLabelText("原编号");

    await user.clear(input);
    await user.type(input, "关闭前编号");
    // 关键:不点别处、不按回车 —— 值此刻只在组件本地 draft 里。
    expect(document.activeElement).toBe(input);
    expect(currentBank.items[0].sourceNumber).not.toBe("关闭前编号");

    await closeListener!();

    expect(savedBanks).toHaveLength(1);
    expect(savedBanks[0].items[0].sourceNumber).toBe("关闭前编号");
  });

  it("aborts the close and reports why when the draft fails validation", async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = await screen.findByLabelText("原编号");

    await user.clear(input);
    await user.type(input, "示例 2");
    expect(document.activeElement).toBe(input);

    // reject 会被 preload 转成 {ok:false,error},主进程据此弹「尚未保存」对话框。
    await expect(closeListener!()).rejects.toThrow(/已被使用/);
    expect(savedBanks).toEqual([]);
  });

  it("saves a half-typed tag that was never committed with Enter", async () => {
    const user = userEvent.setup();
    render(<App />);
    const tagInput = await screen.findByLabelText("添加标签");

    await user.click(tagInput);
    await user.type(tagInput, "洛必达");
    expect(document.activeElement).toBe(tagInput);

    await closeListener!();

    expect(savedBanks).toHaveLength(1);
    expect(savedBanks[0].items[0].tags).toContain("洛必达");
  });

  it("still flushes normally when nothing is focused", async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = await screen.findByLabelText("原编号");

    await user.clear(input);
    await user.type(input, "已失焦编号");
    input.blur();
    await waitFor(() =>
      expect(currentBank.items[0].sourceNumber).toBe("已失焦编号")
    );
    savedBanks = [];

    await expect(closeListener!()).resolves.toBeUndefined();
  });

  it("rejects close immediately while a save conflict is unresolved", async () => {
    forceSaveConflict = true;
    const user = userEvent.setup();
    render(<App />);
    const input = await screen.findByLabelText("原编号");

    await user.clear(input);
    await user.type(input, "仍在内存中的修改");
    await user.tab();
    expect(await screen.findByRole("button", {
      name: "保存冲突 · 处理"
    })).toBeInTheDocument();

    await expect(closeListener!()).rejects.toThrow(
      /题库已被其他程序修改/
    );
    expect(savedBanks).toEqual([]);
  });

  it("waits for a focused latexmk path to finish saving before close", async () => {
    const user = userEvent.setup();
    const deferred = createDeferred<Response>();
    texPathResponse = deferred.promise;
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "题库设置" }));
    const input = screen.getByLabelText("latexmk 路径");

    await user.type(input, "/opt/custom/latexmk");
    expect(document.activeElement).toBe(input);

    let closed = false;
    const closePromise = closeListener!().then(() => {
      closed = true;
    });
    await waitFor(() => expect(savedTexPaths).toEqual(["/opt/custom/latexmk"]));
    expect(closed).toBe(false);

    deferred.resolve(json(appInfoWithTexPath("/opt/custom/latexmk")));
    await expect(closePromise).resolves.toBeUndefined();
    expect(closed).toBe(true);
  });

  it("rejects close when the focused latexmk path cannot be saved", async () => {
    const user = userEvent.setup();
    texPathResponse = Promise.resolve(
      json({ error: "LaTeX 路径写入失败。" }, 500)
    );
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "题库设置" }));
    const input = screen.getByLabelText("latexmk 路径");

    await user.type(input, "/broken/latexmk");

    await expect(closeListener!()).rejects.toThrow("LaTeX 路径写入失败。");
    expect(await screen.findByText("LaTeX 路径写入失败。")).toBeInTheDocument();
  });

  it("does not write an unchanged latexmk path", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "题库设置" }));
    const input = screen.getByLabelText("latexmk 路径");

    await user.click(input);
    await user.tab();
    await closeListener!();

    expect(savedTexPaths).toEqual([]);
  });

  it("serializes latexmk saves and persists the latest blurred value", async () => {
    const user = userEvent.setup();
    const first = createDeferred<Response>();
    texPathResponses = [
      first.promise,
      Promise.resolve(json(appInfoWithTexPath("/second/latexmk")))
    ];
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "题库设置" }));
    const input = screen.getByLabelText("latexmk 路径");

    await user.type(input, "/first/latexmk");
    await user.tab();
    await user.click(input);
    await user.clear(input);
    await user.type(input, "/second/latexmk");
    await user.tab();
    expect(savedTexPaths).toEqual(["/first/latexmk"]);

    first.resolve(json(appInfoWithTexPath("/first/latexmk")));
    await waitFor(() => expect(savedTexPaths).toEqual([
      "/first/latexmk",
      "/second/latexmk"
    ]));
    await closeListener!();

    expect(savedTexPaths).toHaveLength(2);
    expect(input).toHaveValue("/second/latexmk");
  });
});

/**
 * 示例题库的两道题在不同章节,而原编号唯一性是按章节判定的。
 * 把第二题挪进第一章,才能构造出冲突场景。
 */
function sameChapterBank(): Bank {
  const bank = createSampleBank();
  const chapterId = bank.chapters[0].id;
  return {
    ...bank,
    items: bank.items.map((item, index) => ({
      ...item,
      chapterId,
      chapterOrder: index + 1
    }))
  };
}

async function handleFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const url = String(input);
  if (url === "/api/app") return json(appInfo);
  if (url === "/api/bank" && !init) {
    return json({
      workspacePath,
      revision: "close-flush-revision",
      bank: currentBank
    });
  }
  if (url === "/api/bank" && init?.method === "PUT") {
    const request = JSON.parse(String(init.body)) as { bank: Bank };
    if (forceSaveConflict) {
      return json({
        error: "题库已被其他程序修改。",
        code: "BANK_CONFLICT"
      }, 409);
    }
    currentBank = request.bank;
    savedBanks.push(request.bank);
    return json({
      workspacePath,
      revision: crypto.randomUUID(),
      bank: request.bank
    });
  }
  if (url === "/api/tex-path" && init?.method === "POST") {
    const request = JSON.parse(String(init.body)) as { texPath: string };
    savedTexPaths.push(request.texPath);
    return texPathResponses.shift()
      ?? texPathResponse
      ?? json(appInfoWithTexPath(request.texPath));
  }
  if (url === "/api/exports/default-name") {
    return json({ exportName: "questions-close-flush" });
  }
  return json({ error: `Unhandled ${url}` }, 404);
}

function appInfoWithTexPath(texPath: string): AppInfo {
  return {
    ...appInfo,
    appState: {
      ...appInfo.appState,
      texPathOverride: texPath
    },
    texStatus: {
      available: true,
      command: texPath,
      source: "override",
      message: `已检测到 LaTeX：${texPath}`
    }
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
