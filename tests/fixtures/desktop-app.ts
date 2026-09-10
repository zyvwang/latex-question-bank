import { _electron as electron } from "@playwright/test";
import { createSampleBank } from "../../server/bank-schema.js";
import type { Bank, LegacyBank } from "../../shared/types.js";
export function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    error.code === "ENOENT";
}

interface MessageBoxCall {
  message: string;
  detail: string;
  buttons: string[];
}

type MessageBoxRecorder = typeof globalThis & {
  __closeMessageBoxCalls?: MessageBoxCall[];
};

export async function installMessageBoxRecorder(
  electronApp: Awaited<ReturnType<typeof electron.launch>>,
  response: number
) {
  await electronApp.evaluate(({ dialog }, chosen) => {
    const store = globalThis as typeof globalThis & {
      __closeMessageBoxCalls?: Array<{
        message: string;
        detail: string;
        buttons: string[];
      }>;
    };
    store.__closeMessageBoxCalls = [];
    dialog.showMessageBox = (async (
      _window: unknown,
      options: { message?: string; detail?: string; buttons?: string[] }
    ) => {
      store.__closeMessageBoxCalls?.push({
        message: options?.message ?? "",
        detail: options?.detail ?? "",
        buttons: options?.buttons ?? []
      });
      return { response: chosen, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  }, response);
}

export async function installHangingMessageBoxRecorder(
  electronApp: Awaited<ReturnType<typeof electron.launch>>
) {
  await electronApp.evaluate(({ dialog }) => {
    const store = globalThis as typeof globalThis & {
      __closeMessageBoxCalls?: Array<{
        message: string;
        detail: string;
        buttons: string[];
      }>;
    };
    store.__closeMessageBoxCalls = [];
    dialog.showMessageBox = (async (
      _window: unknown,
      options: { message?: string; detail?: string; buttons?: string[] }
    ) => {
      store.__closeMessageBoxCalls?.push({
        message: options?.message ?? "",
        detail: options?.detail ?? "",
        buttons: options?.buttons ?? []
      });
      // 永不 resolve:对话框一直开着,测试才能在这段窗口里发第二次关闭检查。
      await new Promise<void>(() => undefined);
      return { response: 0, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  });
}

export async function readMessageBoxCalls(
  electronApp: Awaited<ReturnType<typeof electron.launch>>
): Promise<MessageBoxCall[]> {
  // 应用若已经退出,evaluate 会抛连接错误。这里吞掉并返回空数组,好让断言报出
  // 「没有弹出对话框」这个真正的症状,而不是一句 target has been closed。
  return electronApp
    .evaluate(() => (globalThis as MessageBoxRecorder).__closeMessageBoxCalls ?? [])
    .catch(() => []);
}

export function createConflictingDesktopBank(): Bank {
  const base = createSampleBank();
  const template = base.items[0];
  const timestamp = "2026-07-26T08:00:00.000Z";
  // 两道题都落在未分类;原编号唯一性按章节判定,chapterId 同为 null 即同章节。
  return {
    ...base,
    chapters: [],
    items: [
      {
        ...template,
        id: "conflict-target",
        sourceNumber: "",
        chapterId: null,
        chapterOrder: 1,
        createdAt: timestamp,
        updatedAt: timestamp
      },
      {
        ...template,
        id: "conflict-owner",
        sourceNumber: "冲突编号",
        chapterId: null,
        chapterOrder: 2,
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ]
  };
}

export function createLegacyDesktopBank(): LegacyBank {
  const timestamp = "2026-07-26T08:00:00.000Z";
  return {
    version: 1,
    settings: {
      preamble: "",
      pageSize: "a4",
      spacing: { item: "1em", module: "0.5em" }
    },
    items: [
      {
        id: "legacy-desktop-item",
        order: 1,
        sourceNumber: "旧题 1",
        chapter: "旧章节",
        tags: ["旧标签"],
        star: 5,
        modules: {
          question: { tex: "求 $1+1$。" },
          solution: { tex: "$2$。" },
          note: { tex: "" }
        },
        assets: [],
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ]
  };
}

export function createLargeHeatmapBank(): Bank {
  const base = createSampleBank();
  const chapters = Array.from({ length: 10 }, (_, index) => ({
    id: `large-chapter-${index + 1}`,
    name: `性能章节 ${index + 1}`,
    order: index + 1
  }));
  const template = base.items[0];
  const items = chapters.flatMap((chapter) =>
    Array.from({ length: 100 }, (_, index) => ({
      ...template,
      id: `large-${chapter.order}-${index + 1}`,
      sourceNumber: `${chapter.order}-${index + 1}`,
      chapterId: chapter.id,
      chapterOrder: index + 1,
      modules: {
        question: {
          tex: `性能题 $x_{${chapter.order},${index + 1}}$。`
        },
        solution: { tex: `答案为 $${chapter.order + index + 1}$。` },
        note: { tex: "" }
      }
    }))
  );
  return { ...base, chapters, items };
}
