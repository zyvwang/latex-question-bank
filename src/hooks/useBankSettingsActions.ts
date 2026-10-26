import { useCallback } from "react";
import {
  itemsInChapter,
  orderedChapters
} from "../../shared/chapter-order.js";
import {
  hasUniqueNormalizedNames,
  normalizeUniqueName
} from "../../shared/names.js";
import type {
  Bank,
  BookRecord,
  Chapter
} from "../../shared/types.js";
import type { Notice } from "./controllerTypes.js";

interface BankSettingsActionsOptions {
  bank: Bank | null;
  updateBank: (updater: (current: Bank) => Bank) => void;
  setNotice: (notice: Notice | null) => void;
}

export function useBankSettingsActions({
  bank,
  updateBank,
  setNotice
}: BankSettingsActionsOptions) {
  const createChapter = useCallback((name: string): string | null => {
    if (!bank) return null;
    const normalized = normalizeUniqueName(name);
    if (!normalized) {
      setNotice({ type: "error", text: "章节名称不能为空。" });
      return null;
    }
    if (bank.chapters.some((chapter) => normalizeUniqueName(chapter.name) === normalized)) {
      setNotice({ type: "error", text: "章节名称已存在。" });
      return null;
    }
    const chapter: Chapter = {
      id: crypto.randomUUID(),
      name: name.trim().normalize("NFKC"),
      order: bank.chapters.length + 1
    };
    updateBank((current) => ({
      ...current,
      chapters: [...current.chapters, chapter]
    }));
    setNotice({ type: "ok", text: `已创建章节“${chapter.name}”。` });
    return chapter.id;
  }, [bank, setNotice, updateBank]);

  const renameChapter = useCallback((id: string, name: string): boolean => {
    if (!bank) return false;
    const normalized = normalizeUniqueName(name);
    const candidate = bank.chapters.map((chapter) =>
      chapter.id === id
        ? { ...chapter, name: name.trim().normalize("NFKC") }
        : chapter
    );
    if (!normalized || !hasUniqueNormalizedNames(candidate)) {
      setNotice({
        type: "error",
        text: normalized ? "章节名称已存在。" : "章节名称不能为空。"
      });
      return false;
    }
    updateBank((current) => ({
      ...current,
      chapters: current.chapters.map((chapter) =>
        chapter.id === id
          ? { ...chapter, name: name.trim().normalize("NFKC") }
          : chapter
      )
    }));
    setNotice({ type: "ok", text: "章节名称已更新。" });
    return true;
  }, [bank, setNotice, updateBank]);

  const moveChapter = useCallback((id: string, direction: -1 | 1) => {
    if (!bank) return;
    const chapters = orderedChapters(bank.chapters);
    const index = chapters.findIndex((chapter) => chapter.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= chapters.length) return;
    [chapters[index], chapters[target]] = [chapters[target], chapters[index]];
    updateBank((current) => ({
      ...current,
      chapters: chapters.map((chapter, chapterIndex) => ({
        ...chapter,
        order: chapterIndex + 1
      }))
    }));
  }, [bank, updateBank]);

  const moveChapterToIndex = useCallback((id: string, targetIndex: number) => {
    if (!bank) return;
    const chapters = orderedChapters(bank.chapters);
    const index = chapters.findIndex((chapter) => chapter.id === id);
    if (index < 0 || targetIndex < 0 || targetIndex >= chapters.length) return;
    const [chapter] = chapters.splice(index, 1);
    chapters.splice(targetIndex, 0, chapter);
    updateBank((current) => ({
      ...current,
      chapters: chapters.map((candidate, chapterIndex) => ({
        ...candidate,
        order: chapterIndex + 1
      }))
    }));
  }, [bank, updateBank]);

  const deleteChapter = useCallback((id: string) => {
    if (!bank) return;
    const chapter = bank.chapters.find((candidate) => candidate.id === id);
    if (!chapter) return;
    const movedItems = itemsInChapter(bank.items, id);
    const suffix = movedItems.length
      ? `\n\n其中 ${movedItems.length} 道题将移入未分类。`
      : "";
    if (!window.confirm(`确定删除章节“${chapter.name}”吗？${suffix}`)) return;
    const uncategorizedCount = itemsInChapter(bank.items, null).length;
    const movedOrderById = new Map(
      movedItems.map((item, index) => [item.id, uncategorizedCount + index + 1])
    );
    const now = new Date().toISOString();
    updateBank((current) => ({
      ...current,
      chapters: orderedChapters(
        current.chapters.filter((candidate) => candidate.id !== id)
      ).map((candidate, index) => ({ ...candidate, order: index + 1 })),
      items: current.items.map((item) =>
        item.chapterId === id
          ? {
              ...item,
              chapterId: null,
              chapterOrder: movedOrderById.get(item.id) ?? item.chapterOrder,
              updatedAt: now
            }
          : item
      )
    }));
    setNotice({ type: "ok", text: "章节已删除，相关题目已移入未分类。" });
  }, [bank, setNotice, updateBank]);

  const createBook = useCallback((title: string): string | null => {
    if (!bank) return null;
    const normalized = normalizeUniqueName(title);
    if (!normalized) {
      setNotice({ type: "error", text: "书目名称不能为空。" });
      return null;
    }
    if (bank.books.some((book) => normalizeUniqueName(book.title) === normalized)) {
      setNotice({ type: "error", text: "书目名称已存在。" });
      return null;
    }
    const now = new Date().toISOString();
    const book: BookRecord = {
      id: crypto.randomUUID(),
      title: title.trim().normalize("NFKC"),
      filePath: null,
      fileHash: null,
      answerBookPath: null,
      answerBookHash: null,
      createdAt: now,
      updatedAt: now
    };
    updateBank((current) => ({
      ...current,
      books: [...current.books, book]
    }));
    setNotice({ type: "ok", text: `已创建书目“${book.title}”。` });
    return book.id;
  }, [bank, setNotice, updateBank]);

  const renameBook = useCallback((id: string, title: string): boolean => {
    if (!bank) return false;
    const normalized = normalizeUniqueName(title);
    const candidate = bank.books.map((book) =>
      book.id === id
        ? { ...book, title: title.trim().normalize("NFKC") }
        : book
    );
    if (
      !normalized ||
      !hasUniqueNormalizedNames(candidate.map((book) => ({ name: book.title })))
    ) {
      setNotice({
        type: "error",
        text: normalized ? "书目名称已存在。" : "书目名称不能为空。"
      });
      return false;
    }
    updateBank((current) => ({
      ...current,
      books: current.books.map((book) =>
        book.id === id
          ? {
              ...book,
              title: title.trim().normalize("NFKC"),
              updatedAt: new Date().toISOString()
            }
          : book
      )
    }));
    setNotice({ type: "ok", text: "书目名称已更新。" });
    return true;
  }, [bank, setNotice, updateBank]);

  const setBookPaths = useCallback((
    id: string,
    patch: Pick<BookRecord, "filePath" | "answerBookPath">
  ) => {
    if (!bank) return;
    const book = bank.books.find((candidate) => candidate.id === id);
    if (!book) return;
    const nextFilePath = patch.filePath?.trim() || null;
    const nextAnswerBookPath = patch.answerBookPath?.trim() || null;
    const fileChanged = nextFilePath !== book.filePath;
    const answerBookChanged = nextAnswerBookPath !== book.answerBookPath;
    if (!fileChanged && !answerBookChanged) return;
    const clearedHash =
      (fileChanged && Boolean(book.fileHash)) ||
      (answerBookChanged && Boolean(book.answerBookHash));
    const now = new Date().toISOString();
    updateBank((current) => ({
      ...current,
      books: current.books.map((candidate) => {
        if (candidate.id !== id) return candidate;
        return {
          ...candidate,
          filePath: nextFilePath,
          fileHash: fileChanged ? null : candidate.fileHash,
          answerBookPath: nextAnswerBookPath,
          answerBookHash: answerBookChanged ? null : candidate.answerBookHash,
          updatedAt: now
        };
      })
    }));
    setNotice({
      type: "ok",
      text: clearedHash
        ? "书目路径已更新，对应文件哈希已清空。"
        : "书目路径已更新。"
    });
  }, [bank, setNotice, updateBank]);

  const deleteBook = useCallback((id: string) => {
    if (!bank) return;
    const book = bank.books.find((candidate) => candidate.id === id);
    if (!book) return;
    const referenced = bank.items.filter(
      (item) => item.source?.bookId === id
    ).length;
    if (referenced > 0) {
      setNotice({
        type: "error",
        text: `书目“${book.title}”仍被 ${referenced} 道题引用，无法删除。`
      });
      return;
    }
    if (!window.confirm(`确定删除书目“${book.title}”吗？`)) return;
    updateBank((current) => ({
      ...current,
      books: current.books.filter((candidate) => candidate.id !== id)
    }));
    setNotice({ type: "ok", text: "书目已删除。" });
  }, [bank, setNotice, updateBank]);

  return {
    createChapter,
    renameChapter,
    moveChapter,
    moveChapterToIndex,
    deleteChapter,
    createBook,
    renameBook,
    setBookPaths,
    deleteBook
  };
}
