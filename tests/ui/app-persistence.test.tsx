import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { AppInfo, Bank } from "../../shared/types.js";

import { appInfo, bank, handleFetch, json } from "../fixtures/app-ui.js";
import { userEvent } from "@testing-library/user-event";
import App from "../../src/App.js";
import { setupAppFixture } from "../fixtures/app-ui.js";
vi.mock("../../src/components/LatexEditor.js", () => ({
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea aria-label="latex-editor" value={value} onChange={(event) => onChange(event.target.value)} />
  )
}));


setupAppFixture();

it("locks conflict save-as until a delayed failure and preserves edits", async () => {
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { finish = resolve; });
    vi.spyOn(window, "prompt").mockReturnValue("/tmp/conflict-copy");
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input) === "/api/bank" && init?.method === "PUT") {
        return json({ error: "conflict", code: "BANK_CONFLICT" }, 409);
      }
      if (String(input) === "/api/workspaces/save-as") return pending;
      return handleFetch(input, init);
    });
    const user = userEvent.setup();
    render(<App />);
    const editor = await screen.findByRole("textbox", { name: "latex-editor" });
    fireEvent.change(editor, { target: { value: "必须保留的修改" } });
    const saveAs = await screen.findByRole("button", { name: "另存为新题库" });
    await user.click(saveAs);
    expect(screen.getByRole("button", { name: "暂时关闭" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "用本地版本覆盖" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "题库保存冲突" })).toBeInTheDocument();
    finish(json({ error: "无法另存" }, 500));
    await waitFor(() => expect(screen.getByRole("button", { name: "暂时关闭" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "暂时关闭" }));
    expect(editor).toHaveValue("必须保留的修改");
  });

it("saves before switching workspaces", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("2024-1");

    const sourceInput = screen.getByDisplayValue("2024-1");
    await user.clear(sourceInput);
    await user.type(sourceInput, "切换前修改");
    await user.click(screen.getByRole("button", { name: "题库设置" }));
    await user.click(screen.getByRole("button", { name: /other-bank/ }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/workspaces/switch",
        expect.objectContaining({
          method: "POST"
        })
      );
    });
    expect(screen.getByRole("heading", { name: "题库设置" })).toBeInTheDocument();

    const calls = vi.mocked(fetch).mock.calls;
    const saveIndex = calls.findIndex(([url, init]) => String(url) === "/api/bank" && init?.method === "PUT");
    const switchIndex = calls.findIndex(([url]) => String(url) === "/api/workspaces/switch");
    expect(saveIndex).toBeGreaterThan(-1);
    expect(switchIndex).toBeGreaterThan(saveIndex);
  });

it("does not rewrite a clean bank when switching workspaces", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("2024-1");
    const bankReadsBeforeSwitch = vi.mocked(fetch).mock.calls.filter(
      ([url, init]) => String(url) === "/api/bank" && !init?.method
    ).length;

    await user.click(screen.getByRole("button", { name: "题库设置" }));
    await user.click(screen.getByRole("button", { name: /other-bank/ }));
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/workspaces/switch",
        expect.objectContaining({ method: "POST" })
      );
    });
    expect(
      vi.mocked(fetch).mock.calls.some(
        ([url, init]) => String(url) === "/api/bank" && init?.method === "PUT"
      )
    ).toBe(false);
    expect(
      vi.mocked(fetch).mock.calls.filter(
        ([url, init]) => String(url) === "/api/bank" && !init?.method
      )
    ).toHaveLength(bankReadsBeforeSwitch);
  });

it("serializes saves and coalesces edits made during an in-flight request", async () => {
    const user = userEvent.setup();
    let resolveFirstSave: ((response: Response) => void) | undefined;
    const firstSave = new Promise<Response>((resolve) => {
      resolveFirstSave = resolve;
    });
    const saveBodies: Array<{ workspacePath: string; bank: Bank }> = [];

    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input) === "/api/bank" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { workspacePath: string; bank: Bank };
        saveBodies.push(body);
        if (saveBodies.length === 1) return firstSave;
        return json({ workspacePath: body.workspacePath, revision: "revision-3", bank: body.bank });
      }
      return handleFetch(input, init);
    });

    render(<App />);
    await screen.findByText("2024-1");
    const sourceInput = screen.getByDisplayValue("2024-1");
    await user.clear(sourceInput);
    await user.type(sourceInput, "第一次修改");
    await user.tab();
    await new Promise((resolve) => window.setTimeout(resolve, 650));
    expect(saveBodies).toHaveLength(1);

    await user.clear(sourceInput);
    await user.type(sourceInput, "最终修改");
    await user.tab();
    await new Promise((resolve) => window.setTimeout(resolve, 650));
    expect(saveBodies).toHaveLength(1);

    resolveFirstSave?.(
      json({
        workspacePath: saveBodies[0].workspacePath,
        revision: "revision-2",
        bank: saveBodies[0].bank
      })
    );
    await waitFor(() => expect(saveBodies).toHaveLength(2));
    expect(saveBodies[1].bank.items[0].sourceNumber).toBe("最终修改");
  });

it("pauses a failed save and retries only the latest bank on demand", async () => {
    const user = userEvent.setup();
    let saveAttempts = 0;
    const saveBodies: Bank[] = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input) === "/api/bank" && init?.method === "PUT") {
        saveAttempts += 1;
        const body = JSON.parse(String(init.body)) as { workspacePath: string; bank: Bank };
        saveBodies.push(body.bank);
        if (saveAttempts === 1) {
          return json({ error: "服务器暂时不可用。", code: "INTERNAL_ERROR" }, 500);
        }
        return json({ workspacePath: body.workspacePath, revision: "revision-retried", bank: body.bank });
      }
      return handleFetch(input, init);
    });

    render(<App />);
    await screen.findByText("2024-1");
    const sourceInput = screen.getByDisplayValue("2024-1");
    await user.clear(sourceInput);
    await user.type(sourceInput, "第一次失败");
    await user.tab();
    await new Promise((resolve) => window.setTimeout(resolve, 650));

    await user.clear(sourceInput);
    await user.type(sourceInput, "等待重试的最新版本");
    await user.tab();
    await new Promise((resolve) => window.setTimeout(resolve, 650));
    expect(saveAttempts).toBe(1);

    await user.click(await screen.findByRole("button", { name: "重试保存" }));
    await waitFor(() => expect(saveAttempts).toBe(2));
    expect(saveBodies[1].items[0].sourceNumber).toBe("等待重试的最新版本");
    expect(await screen.findByText("已保存")).toBeInTheDocument();
  });

it("freezes autosave on a persistent bank conflict without a request loop", async () => {
    const user = userEvent.setup();
    let saveAttempts = 0;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input) === "/api/bank" && init?.method === "PUT") {
        saveAttempts += 1;
        return json(
          { error: "题库已被其他程序修改。", code: "BANK_CONFLICT" },
          409
        );
      }
      return handleFetch(input, init);
    });

    render(<App />);
    await screen.findByText("2024-1");
    const sourceInput = screen.getByDisplayValue("2024-1");
    await user.clear(sourceInput);
    await user.type(sourceInput, "冲突后的本地修改");
    await user.tab();
    await new Promise((resolve) => window.setTimeout(resolve, 650));

    expect(await screen.findByRole("dialog", {
      name: "题库保存冲突"
    })).toBeInTheDocument();
    expect(saveAttempts).toBe(1);
    expect(
      screen.queryByRole("button", { name: "重试保存" })
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "暂时关闭" }));

    await user.clear(sourceInput);
    await user.type(sourceInput, "冲突期间继续编辑");
    await user.tab();
    await new Promise((resolve) => window.setTimeout(resolve, 700));
    expect(saveAttempts).toBe(1);
    expect(screen.getByRole("button", {
      name: "保存冲突 · 处理"
    })).toBeInTheDocument();
  });

it("overwrites a conflict with the latest disk revision and latest local bank", async () => {
    const user = userEvent.setup();
    const saveRequests: Array<{
      baseRevision: string;
      bank: Bank;
      workspacePath: string;
    }> = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/bank" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as {
          baseRevision: string;
          bank: Bank;
          workspacePath: string;
        };
        saveRequests.push(body);
        if (saveRequests.length === 1) {
          return json(
            { error: "题库已被其他程序修改。", code: "BANK_CONFLICT" },
            409
          );
        }
        return json({
          workspacePath: body.workspacePath,
          revision: "revision-overwritten",
          bank: body.bank
        });
      }
      if (url === "/api/bank/head") {
        return json({
          workspacePath: "/tmp/latex-bank",
          revision: "latest-disk-revision"
        });
      }
      return handleFetch(input, init);
    });

    render(<App />);
    await screen.findByText("2024-1");
    const sourceInput = screen.getByDisplayValue("2024-1");
    await user.clear(sourceInput);
    await user.type(sourceInput, "引发冲突");
    await user.tab();
    await new Promise((resolve) => window.setTimeout(resolve, 650));
    await screen.findByRole("dialog", { name: "题库保存冲突" });
    await user.click(screen.getByRole("button", { name: "暂时关闭" }));

    await user.clear(sourceInput);
    await user.type(sourceInput, "最终本地版本");
    await user.tab();
    await user.click(screen.getByRole("button", {
      name: "保存冲突 · 处理"
    }));
    await user.click(screen.getByRole("button", {
      name: "用本地版本覆盖"
    }));

    await waitFor(() => expect(saveRequests).toHaveLength(2));
    expect(saveRequests[1].baseRevision).toBe("latest-disk-revision");
    expect(saveRequests[1].bank.items[0].sourceNumber).toBe("最终本地版本");
    expect(await screen.findByText("已保存")).toBeInTheDocument();
  });

it("can discard local conflict edits and resume from the latest disk revision", async () => {
    const user = userEvent.setup();
    const diskBank = {
      ...bank,
      items: bank.items.map((item, index) =>
        index === 0
          ? { ...item, sourceNumber: "磁盘版本" }
          : item
      )
    };
    let bankReads = 0;
    const saveRequests: Array<{
      baseRevision: string;
      bank: Bank;
      workspacePath: string;
    }> = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/bank" && !init?.method) {
        bankReads += 1;
        return bankReads === 1
          ? json({
              workspacePath: "/tmp/latex-bank",
              revision: "revision-1",
              bank
            })
          : json({
              workspacePath: "/tmp/latex-bank",
              revision: "disk-revision",
              bank: diskBank
            });
      }
      if (url === "/api/bank" && init?.method === "PUT") {
        const request = JSON.parse(String(init.body)) as {
          baseRevision: string;
          bank: Bank;
          workspacePath: string;
        };
        saveRequests.push(request);
        if (saveRequests.length === 1) {
          return json(
            { error: "题库已被其他程序修改。", code: "BANK_CONFLICT" },
            409
          );
        }
        return json({
          workspacePath: request.workspacePath,
          revision: "after-disk-reload",
          bank: request.bank
        });
      }
      return handleFetch(input, init);
    });

    render(<App />);
    await screen.findByText("2024-1");
    const sourceInput = screen.getByDisplayValue("2024-1");
    await user.clear(sourceInput);
    await user.type(sourceInput, "将被放弃的本地版本");
    await user.tab();
    await new Promise((resolve) => window.setTimeout(resolve, 650));
    const useDiskButton = await screen.findByRole("button", {
      name: "采用磁盘版本"
    });
    await waitFor(() => expect(useDiskButton).toBeEnabled());
    await user.click(useDiskButton);

    expect(await screen.findByDisplayValue("磁盘版本"))
      .toBeInTheDocument();
    const reloadedInput = screen.getByDisplayValue("磁盘版本");
    await user.clear(reloadedInput);
    await user.type(reloadedInput, "磁盘基础上的新修改");
    await user.tab();
    await new Promise((resolve) => window.setTimeout(resolve, 650));

    await waitFor(() => expect(saveRequests).toHaveLength(2));
    expect(saveRequests[1].baseRevision).toBe("disk-revision");
    expect(saveRequests[1].bank.items[0].sourceNumber).toBe(
      "磁盘基础上的新修改"
    );
  });

it("saves a conflicted local bank as a new independent workspace", async () => {
    const user = userEvent.setup();
    const selectWorkspaceDirectory = vi.fn().mockResolvedValue(
      "/tmp/conflict-copy"
    );
    window.lqb = {
      platform: "darwin",
      selectWorkspaceDirectory,
      openPath: vi.fn().mockResolvedValue(""),
      revealExportFolder: vi.fn().mockResolvedValue(true),
      openExternal: vi.fn().mockResolvedValue(true),
      onBeforeClose: vi.fn(() => () => undefined)
    };
    let requestedBank: Bank | null = null;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/bank" && init?.method === "PUT") {
        return json(
          { error: "题库已被其他程序修改。", code: "BANK_CONFLICT" },
          409
        );
      }
      if (url === "/api/workspaces/save-as") {
        const request = JSON.parse(String(init?.body)) as {
          bank: Bank;
          targetWorkspacePath: string;
        };
        requestedBank = request.bank;
        const nextAppInfo = {
          ...appInfo,
          currentWorkspaceName: "conflict-copy",
          currentWorkspacePath: request.targetWorkspacePath,
          appState: {
            ...appInfo.appState,
            currentWorkspacePath: request.targetWorkspacePath
          }
        };
        return json({
          appInfo: nextAppInfo,
          snapshot: {
            workspacePath: request.targetWorkspacePath,
            revision: "copy-revision",
            bank: request.bank
          }
        });
      }
      return handleFetch(input, init);
    });

    render(<App />);
    await screen.findByText("2024-1");
    const sourceInput = screen.getByDisplayValue("2024-1");
    await user.clear(sourceInput);
    await user.type(sourceInput, "需要另存的本地版本");
    await user.tab();
    await new Promise((resolve) => window.setTimeout(resolve, 650));
    await user.click(await screen.findByRole("button", {
      name: "另存为新题库"
    }));

    await waitFor(() => expect(requestedBank).not.toBeNull());
    expect(requestedBank!.items[0].sourceNumber).toBe(
      "需要另存的本地版本"
    );
    expect(await screen.findByText("conflict-copy")).toBeInTheDocument();
    expect(await screen.findByText("已保存")).toBeInTheDocument();
  });

it("shows recovery actions instead of an endless loading screen", async () => {
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/bank" && !init?.method) {
        return json({ error: "bank.json 不是有效的 JSON。", code: "BANK_JSON_INVALID" }, 500);
      }
      if (url === "/api/recovery" && !init?.method) {
        return json({
          candidates: [
            {
              id: "bank.json.bak",
              label: "最近一次保存前的备份",
              createdAt: "2026-01-01T00:00:00.000Z",
              source: "backup"
            }
          ]
        });
      }
      if (url === "/api/recovery" && init?.method === "POST") {
        return json({ workspacePath: "/tmp/latex-bank", revision: "recovered", bank });
      }
      return handleFetch(input, init);
    });

    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText("磁盘数据没有被覆盖")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /最近一次保存前的备份/ }));
    expect(await screen.findByText("2024-1")).toBeInTheDocument();
  });

it("offers valid recent workspaces when the current workspace is missing", async () => {
    const missingAppInfo: AppInfo = {
      ...appInfo,
      appState: {
        ...appInfo.appState,
        currentWorkspacePath: "/tmp/missing-bank",
        recentWorkspacePaths: ["/tmp/missing-bank", "/tmp/other-bank"]
      },
      currentWorkspaceName: "missing-bank",
      currentWorkspacePath: "/tmp/missing-bank",
      recentWorkspaces: [
        { name: "missing-bank", path: "/tmp/missing-bank", exists: false },
        { name: "other-bank", path: "/tmp/other-bank", exists: true }
      ]
    };
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/app") return json(missingAppInfo);
      if (url === "/api/bank" && !init?.method) {
        return json(
          { error: "当前工作区缺少 bank.json。", code: "WORKSPACE_MISSING" },
          404
        );
      }
      if (url === "/api/recovery" && !init?.method) {
        return json({ candidates: [] });
      }
      return handleFetch(input, init);
    });

    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText("原题库位置已失效")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新定位" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "选择其他工作区" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "移除失效记录" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /切换到 other-bank/ }));
    expect(await screen.findByText("2024-1")).toBeInTheDocument();
  });

it("locks recovery, retry and switching until a failed restore settles", async () => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { finish = resolve; });
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    if (String(input) === "/api/bank" && !init?.method) return json({ error: "损坏" }, 500);
    if (String(input) === "/api/recovery") {
      if (init?.method === "POST") return pending;
      return json({ candidates: [{ id: "bank.json.bak", label: "恢复测试备份", source: "backup" }] });
    }
    return handleFetch(input, init);
  });
  render(<App />);
  const restore = await screen.findByRole("button", { name: "恢复测试备份" });
  fireEvent.click(restore);
  fireEvent.click(restore);
  expect(restore).toBeDisabled();
  expect(screen.getByRole("button", { name: "重试" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "切换到 other-bank" })).toBeDisabled();
  const calls = vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url) === "/api/recovery" && init?.method === "POST");
  expect(calls).toHaveLength(1);
  expect(JSON.parse(String(calls[0][1]?.body))).toEqual({ candidateId: "bank.json.bak", workspacePath: appInfo.currentWorkspacePath });
  finish(json({ error: "候选已失效" }, 400));
  await waitFor(() => expect(restore).toBeEnabled());
  expect(screen.getByText("候选已失效")).toBeVisible();
});

it("reconciles an uncertain workspace switch before allowing another action", async () => {
  let switched = false;
  let verifyFails = true;
  const nextApp = { ...appInfo, currentWorkspacePath: "/tmp/other-bank", currentWorkspaceName: "other-bank" };
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === "/api/workspaces/switch") {
      switched = true;
      return json({ error: "结果尚未确认", code: "WRITE_RESULT_UNKNOWN" }, 504);
    }
    if (switched && url === "/api/app") {
      if (verifyFails) return json({ error: "读取失败" }, 500);
      return json(nextApp);
    }
    if (switched && url === "/api/bank" && !init?.method) return json({ workspacePath: "/tmp/other-bank", revision: "verified", bank });
    return handleFetch(input, init);
  });
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "题库设置" }));
  await user.click(screen.getByRole("button", { name: /other-bank/ }));
  const check = await screen.findByRole("button", { name: "核对工作区状态" });
  await waitFor(() => expect(check).toBeEnabled());
  verifyFails = false;
  await user.click(check);
  await waitFor(() => expect(screen.queryByRole("button", { name: "核对工作区状态" })).not.toBeInTheDocument());
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === "/api/workspaces/switch")).toHaveLength(1);
});

it("keeps local edits when the pre-switch save times out instead of reloading disk", async () => {
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    if (String(input) === "/api/bank" && init?.method === "PUT") {
      return json({ error: "保存结果尚未确认", code: "WRITE_RESULT_UNKNOWN" }, 504);
    }
    return handleFetch(input, init);
  });
  const user = userEvent.setup();
  render(<App />);
  const editor = await screen.findByRole("textbox", { name: "latex-editor" });
  fireEvent.change(editor, { target: { value: "超时后必须保留的本地草稿" } });
  await user.click(screen.getByRole("button", { name: "题库设置" }));
  await user.click(screen.getByRole("button", { name: /other-bank/ }));
  expect(await screen.findByText("保存结果尚未确认")).toBeVisible();
  expect(screen.queryByRole("button", { name: "核对工作区状态" })).not.toBeInTheDocument();
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === "/api/workspaces/switch")).toHaveLength(0);
  await user.click(screen.getByRole("button", { name: "编辑" }));
  expect(await screen.findByRole("textbox", { name: "latex-editor" })).toHaveValue("超时后必须保留的本地草稿");
});
