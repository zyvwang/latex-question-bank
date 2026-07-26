import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSampleBank } from "../../server/bank-schema.js";
import type { AppInfo, Bank, QuestionItem } from "../../shared/types.js";
import App from "../../src/App.js";
import {
  recordReviewMutation,
  type ReviewMutationResult
} from "../../src/review-history.js";

vi.mock("../../src/components/LatexEditor.js", () => ({
  default: ({ value }: { value: string }) => (
    <textarea aria-label="latex-editor" readOnly value={value} />
  )
}));

const appInfo: AppInfo = {
  appState: {
    version: 1,
    currentWorkspacePath: "/tmp/history-bank",
    recentWorkspacePaths: ["/tmp/history-bank"]
  },
  currentWorkspaceName: "历史测试题库",
  currentWorkspacePath: "/tmp/history-bank",
  recentWorkspaces: [
    { name: "历史测试题库", path: "/tmp/history-bank", exists: true }
  ],
  texStatus: {
    available: true,
    command: "latexmk",
    source: "path",
    message: "已检测到 LaTeX：latexmk"
  },
  isDesktop: false,
  setupRequired: false
};

let currentBank: Bank;

beforeEach(() => {
  vi.useRealTimers();
  currentBank = createSampleBank();
  vi.stubGlobal("fetch", vi.fn(handleFetch));
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("mastery history UI", () => {
  it("merges review changes into one daily record and exposes its detail", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText("原编号");

    await user.click(screen.getByRole("radio", { name: "太难了" }));
    await user.click(
      within(screen.getByRole("group", { name: "错误原因" }))
        .getByRole("checkbox", { name: "知识问题" })
    );
    await user.click(screen.getByRole("button", { name: "题库设置" }));

    expect(screen.getByText("1 / 5")).toBeInTheDocument();
    const historyNav = screen.getByRole("navigation", {
      name: "掌握历史记录"
    });
    expect(within(historyNav).getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("table", { name: "历史题目状态" }))
      .toHaveTextContent("太难了");
    expect(screen.getByRole("table", { name: "历史题目状态" }))
      .toHaveTextContent("知识问题");
  });

  it("validates normalized names and supports viewing, renaming, and deleting", async () => {
    currentBank = withPastHistory(2);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "题库设置" }));

    const historyNav = screen.getByRole("navigation", {
      name: "掌握历史记录"
    });
    const historyButtons = within(historyNav).getAllByRole("button");
    expect(historyButtons).toHaveLength(2);
    await user.click(historyButtons[1]);

    const nameInput = screen.getByLabelText("历史名称");
    const otherName = within(historyButtons[0]).getByText(
      /历史测试题库/
    ).textContent!;
    await user.clear(nameInput);
    await user.type(nameInput, `  ${otherName.toLocaleUpperCase("en-US")}  `);
    nameInput.blur();
    expect(await screen.findByText("历史名称已存在。")).toBeInTheDocument();

    await user.clear(nameInput);
    await user.type(nameInput, "第一次复习");
    nameInput.blur();
    expect(await screen.findByText("掌握历史名称已更新。")).toBeInTheDocument();
    expect(nameInput).toHaveValue("第一次复习");

    vi.mocked(window.confirm).mockReturnValueOnce(false);
    await user.click(screen.getByRole("button", { name: "删除" }));
    expect(within(historyNav).getAllByRole("button")).toHaveLength(2);

    vi.mocked(window.confirm).mockReturnValueOnce(true);
    await user.click(screen.getByRole("button", { name: "删除" }));
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("不会删除磁盘恢复快照")
    );
    expect(within(historyNav).getAllByRole("button")).toHaveLength(1);
  });

  it("restores review state without removing items added later and records the restore", async () => {
    const snapshotDate = daysAgo(2);
    currentBank = expectOk(recordReviewMutation(
      currentBank,
      (bank) => ({
        ...bank,
        items: bank.items.map((item, index) =>
          index === 0
            ? {
                ...item,
                masteryOptionId: "mastery-hard",
                errorReasonOptionIds: ["error-method"]
              }
            : item
        )
      }),
      historyOptions(snapshotDate, "restore-source")
    ));
    const added: QuestionItem = {
      ...currentBank.items[0],
      id: "added-later",
      sourceNumber: "后来新增",
      chapterId: null,
      chapterOrder: 1,
      masteryOptionId: "mastery-easy",
      errorReasonOptionIds: []
    };
    currentBank = {
      ...currentBank,
      items: [
        {
          ...currentBank.items[0],
          masteryOptionId: "mastery-easy",
          errorReasonOptionIds: ["error-calculation"]
        },
        currentBank.items[1],
        added
      ]
    };

    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "题库设置" }));
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    await user.click(screen.getByRole("button", { name: "恢复" }));
    expect(screen.getByText("1 / 5")).toBeInTheDocument();

    vi.mocked(window.confirm).mockReturnValueOnce(true);
    await user.click(screen.getByRole("button", { name: "恢复" }));
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("题目正文、章节、题序和素材保持不变")
    );

    expect(screen.getByText("2 / 5")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.getByRole("radio", { name: "太难了" })).toBeChecked();
    expect(
      within(screen.getByRole("group", { name: "错误原因" }))
        .getByRole("checkbox", { name: "方法问题" })
    ).toBeChecked();
    expect(screen.getByText("后来新增")).toBeInTheDocument();
  });

  it("cancels a sixth snapshot without applying the edit, then deletes the chosen record", async () => {
    currentBank = withPastHistory(5);
    currentBank = {
      ...currentBank,
      items: currentBank.items.map((item, index) =>
        index === 0 ? { ...item, masteryOptionId: "mastery-easy" } : item
      )
    };
    const oldestName = currentBank.masteryHistory[0].name;
    const secondName = currentBank.masteryHistory[1].name;
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText("原编号");

    await user.click(screen.getByRole("radio", { name: "太难了" }));
    const dialog = screen.getByRole("dialog", {
      name: "选择一份历史删除"
    });
    expect(within(dialog).getByRole("radio", {
      name: new RegExp(oldestName)
    })).toBeChecked();
    await user.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(screen.getByRole("radio", { name: "很简单" })).toBeChecked();
    expect(screen.getByText("已取消，本次掌握修改未应用。")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "太难了" }));
    const secondDialog = screen.getByRole("dialog", {
      name: "选择一份历史删除"
    });
    await user.click(within(secondDialog).getByRole("radio", {
      name: new RegExp(secondName)
    }));
    await user.click(within(secondDialog).getByRole("button", {
      name: "删除所选并继续"
    }));
    expect(screen.getByRole("radio", { name: "太难了" })).toBeChecked();

    await user.click(screen.getByRole("button", { name: "题库设置" }));
    expect(screen.getByText("5 / 5")).toBeInTheDocument();
    const historyNav = screen.getByRole("navigation", {
      name: "掌握历史记录"
    });
    expect(within(historyNav).queryByText(secondName)).not.toBeInTheDocument();
    expect(within(historyNav).getByText(oldestName)).toBeInTheDocument();
  });

  it("edits an option definition at full capacity without demanding a deletion", async () => {
    currentBank = withPastHistory(5);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "题库设置" }));
    expect(screen.getByText("5 / 5")).toBeInTheDocument();

    // 选项定义的改动不触碰任何题目的复习状态,不应记入当天历史、更不该逼用户删一份。
    await user.selectOptions(
      screen.getByLabelText("很简单图案"),
      "crosshatch"
    );

    expect(screen.queryByRole("dialog", { name: "选择一份历史删除" }))
      .not.toBeInTheDocument();
    expect(screen.getByText("选项已更新。")).toBeInTheDocument();
    expect(screen.getByText("5 / 5")).toBeInTheDocument();
  });

  it("keeps edits made while the capacity dialog is open", async () => {
    currentBank = withPastHistory(5);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "题库设置" }));

    const historyNav = screen.getByRole("navigation", {
      name: "掌握历史记录"
    });
    const historyButtons = within(historyNav).getAllByRole("button");
    await user.click(historyButtons[historyButtons.length - 1]);
    await user.click(screen.getByRole("button", { name: "恢复" }));
    const dialog = screen.getByRole("dialog", { name: "选择一份历史删除" });

    // 选项定义的改动走 updateBank,不受容量对话框拦截。恢复的 updater 被延后到
    // 确认时才执行,必须基于那时的 bank 重算,否则这次改动会被静默丢掉。
    await user.selectOptions(screen.getByLabelText("很简单图案"), "crosshatch");
    await user.click(within(dialog).getByRole("button", {
      name: "删除所选并继续"
    }));

    expect(screen.getByLabelText("很简单图案")).toHaveValue("crosshatch");
  });

  it("traps keyboard focus inside the capacity dialog and returns it on cancel", async () => {
    currentBank = withPastHistory(5);
    // withPastHistory 最后一轮把首题留在「太难了」,先挪开,点击才是一次真实变更。
    currentBank = {
      ...currentBank,
      items: currentBank.items.map((item, index) =>
        index === 0 ? { ...item, masteryOptionId: "mastery-easy" } : item
      )
    };
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText("原编号");

    const trigger = screen.getByRole("radio", { name: "太难了" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "选择一份历史删除" });
    expect(dialog.contains(document.activeElement)).toBe(true);

    // aria-modal="true" 承诺焦点收敛。遮罩只挡指针,没有 trap 时 Tab 能穿到背后的
    // 编辑器继续打字 —— 那正是上面那条编辑丢失的触发路径。
    for (let step = 0; step < 12; step += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(document.activeElement).toBe(trigger);
  });

  it("never offers the history being restored as the deletion candidate", async () => {
    currentBank = withPastHistory(5);
    const oldestName = currentBank.masteryHistory[0].name;
    const secondOldestName = currentBank.masteryHistory[1].name;
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "题库设置" }));

    const historyNav = screen.getByRole("navigation", {
      name: "掌握历史记录"
    });
    // 列表按新到旧排列,最后一个才是最早那份。
    const historyButtons = within(historyNav).getAllByRole("button");
    await user.click(historyButtons[historyButtons.length - 1]);
    await user.click(screen.getByRole("button", { name: "恢复" }));

    // 默认删除最早一份 == 正在恢复的这份,确认后它会被恢复完又立刻删掉。
    const dialog = screen.getByRole("dialog", { name: "选择一份历史删除" });
    expect(within(dialog).queryByRole("radio", {
      name: new RegExp(oldestName)
    })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("radio", {
      name: new RegExp(secondOldestName)
    })).toBeChecked();

    await user.click(within(dialog).getByRole("button", {
      name: "删除所选并继续"
    }));
    expect(within(historyNav).getByText(oldestName)).toBeInTheDocument();
    expect(within(historyNav).queryByText(secondOldestName))
      .not.toBeInTheDocument();
  });
});

async function handleFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const url = String(input);
  if (url === "/api/app") return json(appInfo);
  if (url === "/api/bank" && !init) {
    return json({
      workspacePath: appInfo.currentWorkspacePath,
      revision: "history-revision",
      bank: currentBank
    });
  }
  if (url === "/api/bank" && init?.method === "PUT") {
    const request = JSON.parse(String(init.body)) as {
      workspacePath: string;
      bank: Bank;
    };
    currentBank = request.bank;
    return json({
      workspacePath: request.workspacePath,
      revision: crypto.randomUUID(),
      bank: request.bank
    });
  }
  if (url === "/api/exports/default-name") {
    return json({ exportName: "questions-history-test" });
  }
  return json({ error: `Unhandled ${url}` }, 404);
}

function withPastHistory(count: number): Bank {
  let bank = currentBank;
  for (let index = count; index >= 1; index -= 1) {
    bank = expectOk(recordReviewMutation(
      bank,
      (current) => ({
        ...current,
        items: current.items.map((item, itemIndex) =>
          itemIndex === 0
            ? {
                ...item,
                masteryOptionId:
                  index % 2 ? "mastery-hard" : "mastery-challenging"
              }
            : item
        )
      }),
      historyOptions(daysAgo(index), `past-history-${index}`)
    ));
  }
  return bank;
}

function expectOk(result: ReviewMutationResult): Bank {
  if (!result.ok) {
    throw new Error(`预期变更成功，实际失败：${result.error}`);
  }
  return result.bank;
}

function historyOptions(now: Date, id: string) {
  return {
    workspaceName: appInfo.currentWorkspaceName,
    now,
    createId: () => id
  };
}

function daysAgo(count: number): Date {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - count);
  return date;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
