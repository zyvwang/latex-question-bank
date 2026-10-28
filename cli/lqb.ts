import { createHash, randomBytes } from "node:crypto";
import {
  access,
  constants,
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  AgentImportManifest,
  AgentImportSummary
} from "../shared/agent-manifest.js";
import { validateAgentImportManifest } from "../shared/agent-manifest.js";
import {
  AGENT_TAG_FIELD_LABELS,
  validateAgentTagJournal,
  validateAgentTagManifest,
  type AgentTagField,
  type AgentTagJournal,
  type AgentTagManifest,
  type AgentTagSummary,
  type AgentTagUndoSummary
} from "../shared/agent-tags.js";
import type { AgentImageNormalizeSummary } from "../shared/agent-images.js";
import type { AgentUndoSummary } from "../shared/agent-undo.js";
import { orderItemsByChapter } from "../shared/chapter-order.js";
import type { Bank, QuestionItem } from "../shared/types.js";
import {
  AGENT_GUIDE,
  LQB_README,
  MANIFEST_EXAMPLE,
  SKILL_MD
} from "./templates.js";

interface AgentDiscovery {
  version: 1;
  port: number;
  token: string;
  workspacePath: string;
  pid: number;
}

interface AgentStatus {
  appVersion: string;
  workspacePath: string;
  workspaceName: string;
  setupRequired: boolean;
  revision: string;
  pendingCount: number;
  books: Array<{ id: string; title: string }>;
}

interface BankSnapshot {
  workspacePath: string;
  revision: string;
  bank: Bank;
}

interface LinkInfo {
  version: 1;
  workspacePath: string;
  linkedAt: string;
}

interface ParsedArgs {
  positionals: string[];
  flags: Map<string, string | boolean>;
}

const VALUE_FLAGS = new Set([
  "workspace",
  "file",
  "batch-id",
  "dir",
  "limit",
  "book",
  "chapter",
  "topic",
  "type",
  "priority",
  "status",
  "name",
  "path"
]);

class CliError extends Error {
  constructor(
    public readonly exitCode: number,
    message: string
  ) {
    super(message);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const [command, ...rest] = args.positionals;
  if (!command || args.flags.has("help")) {
    printHelp();
    return;
  }
  switch (command) {
    case "status":
      return statusCommand(args);
    case "link":
      return linkCommand(args);
    case "agent-init":
      return agentInitCommand(args);
    case "import":
      return importCommand(args, rest);
    case "list":
      return listCommand(args);
    case "search":
      return searchCommand(args, rest.join(" "));
    case "get":
      return getCommand(args, rest[0]);
    case "bank":
      if (rest[0] === "create") return bankCreateCommand(args);
      break;
    case "book":
      if (rest[0] === "list") return bookListCommand(args);
      break;
    case "batch":
      if (rest[0] === "list") return batchListCommand(args);
      break;
    case "topic":
      return fieldCommand("topics", args, rest);
    case "type":
      return fieldCommand("questionTypes", args, rest);
    case "image":
      if (rest[0] === "normalize") return imageNormalizeCommand(args);
      break;
    case "tag":
      throw new CliError(
        1,
        "lqb tag 已拆分：考点用 lqb topic，题型用 lqb type（见 lqb --help）。"
      );
    case "manifest":
      if (rest[0] === "example") {
        process.stdout.write(`${MANIFEST_EXAMPLE}\n`);
        return;
      }
      break;
    default:
      break;
  }
  throw new CliError(1, `未知命令：${args.positionals.join(" ")}`);
}

async function statusCommand(args: ParsedArgs): Promise<void> {
  const discovery = await readDiscovery();
  const status = await agentStatus(discovery);
  if (args.flags.has("json")) {
    printJson(status);
    return;
  }
  console.log(`应用：${status.appVersion}`);
  console.log(`工作区：${status.workspaceName}`);
  console.log(`路径：${status.workspacePath || "未设置"}`);
  console.log(`revision：${status.revision}`);
  console.log(`待审阅：${status.pendingCount} 道`);
  console.log(`书目：${status.books.map((book) => book.title).join("、") || "无"}`);
}

async function linkCommand(args: ParsedArgs): Promise<void> {
  const discovery = await readDiscovery();
  const status = await agentStatus(discovery);
  const workspacePathValue =
    stringFlag(args.flags, "workspace") || status.workspacePath;
  if (!workspacePathValue) {
    throw new CliError(4, "应用还没有打开题库，请先新建或打开一个工作区。");
  }
  const workspacePath = path.resolve(workspacePathValue);
  const link: LinkInfo = {
    version: 1,
    workspacePath,
    linkedAt: new Date().toISOString()
  };
  await writeFile(
    path.join(process.cwd(), ".lqb.json"),
    `${JSON.stringify(link, null, 2)}\n`,
    "utf8"
  );
  if (args.flags.has("json")) {
    printJson(link);
    return;
  }
  console.log(`已链接题库：${workspacePath}`);
}

async function agentInitCommand(args: ParsedArgs): Promise<void> {
  const targetDir = path.resolve(
    stringFlag(args.flags, "dir") ?? process.cwd()
  );
  const force = args.flags.has("force");
  await mkdir(targetDir, { recursive: true });
  const agentsPath = path.join(targetDir, "AGENTS.md");
  const agentsExists = await fileExists(agentsPath);
  const guidePath =
    agentsExists && !force ? path.join(targetDir, "AGENTS.lqb.md") : agentsPath;
  if (force || !(await fileExists(guidePath))) {
    await writeFile(guidePath, AGENT_GUIDE, "utf8");
  }
  const skillDir = path.join(
    targetDir,
    ".agents",
    "skills",
    "latex-question-bank"
  );
  await mkdir(skillDir, { recursive: true });
  const skillPath = path.join(skillDir, "SKILL.md");
  if (force || !(await fileExists(skillPath))) {
    await writeFile(skillPath, SKILL_MD, "utf8");
  }
  const lqbDir = path.join(targetDir, ".lqb");
  await mkdir(lqbDir, { recursive: true });
  const examplePath = path.join(lqbDir, "manifest.example.json");
  if (force || !(await fileExists(examplePath))) {
    await writeFile(examplePath, MANIFEST_EXAMPLE, "utf8");
  }
  const readmePath = path.join(lqbDir, "README.md");
  if (force || !(await fileExists(readmePath))) {
    await writeFile(readmePath, LQB_README, "utf8");
  }
  console.log(`已初始化 Agent 工作目录：${targetDir}`);
  console.log(`- ${guidePath}`);
  console.log(`- ${skillPath}`);
  console.log(`- ${examplePath}`);
  if (agentsExists && !force && guidePath !== agentsPath) {
    console.log("已有 AGENTS.md；说明写入 AGENTS.lqb.md，请手动引用它。");
  }
}

async function importCommand(
  args: ParsedArgs,
  rest: string[]
): Promise<void> {
  if (rest[0] === "undo") {
    return undoCommand(args, rest[1]);
  }
  const file = stringFlag(args.flags, "file");
  if (!file) throw new CliError(1, "lqb import 需要 --file <manifest.json>。");
  const manifestPath = path.resolve(file);
  const manifestDir = path.dirname(manifestPath);
  let manifest: AgentImportManifest;
  try {
    const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
    const validation = validateAgentImportManifest(parsed);
    if (!validation.ok || !validation.value) {
      throw new CliError(2, validation.error ?? "导入清单无效。");
    }
    manifest = validation.value;
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(
      2,
      error instanceof Error ? error.message : "读取导入清单失败。"
    );
  }
  applyBatchFlag(manifest, stringFlag(args.flags, "batch-id"));
  const createBank = args.flags.has("create-bank");
  if (createBank) {
    if (!manifest.bank) {
      throw new CliError(
        2,
        "lqb import --create-bank 需要清单提供 bank.name。"
      );
    }
    if (manifest.bank.path) {
      manifest.bank.path = path.resolve(manifestDir, manifest.bank.path);
    }
  } else if (manifest.bank || (manifest.chapters?.length ?? 0) > 0) {
    throw new CliError(
      2,
      "清单中的 bank/chapters 只能与 --create-bank 一起使用。"
    );
  }
  await resolveBookPaths(manifest, manifestDir);
  const discovery = await readDiscovery();
  let status = await agentStatus(discovery);
  let workspacePath = "";
  if (!createBank) {
    const target = await resolveTarget(discovery, status, args, true);
    status = target.status;
    workspacePath = target.workspacePath;
  }
  const form = new FormData();
  if (!createBank) {
    form.append("workspacePath", workspacePath);
    form.append("baseRevision", status.revision);
  }
  form.append("manifest", JSON.stringify(manifest));
  form.append("dryRun", String(args.flags.has("dry-run")));
  form.append("overwrite", String(args.flags.has("overwrite")));
  form.append("createBank", String(createBank));
  form.append("switchWorkspace", String(args.flags.has("switch")));
  for (const asset of manifest.assets ?? []) {
    const assetPath = path.resolve(
      manifestDir,
      asset.filePath ?? asset.originalName
    );
    const mime = imageMime(assetPath);
    if (!mime) {
      throw new CliError(
        2,
        `附件必须是 PNG 或 JPEG：${assetPath}`
      );
    }
    let buffer: Buffer;
    try {
      buffer = await readFile(assetPath);
    } catch {
      throw new CliError(2, `附件不存在：${assetPath}`);
    }
    const bytes = new Uint8Array(buffer.byteLength);
    bytes.set(buffer);
    form.append(
      "assets",
      new Blob([bytes], { type: mime }),
      asset.originalName
    );
  }
  const response = await agentRequest(discovery, "/api/agent/import", {
    method: "POST",
    body: form
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw apiError(response.status, payload);
  const summary = payload as AgentImportSummary;
  printImportSummary(summary, args.flags.has("json"));
  if (summary.status === "partial") process.exitCode = 3;
}

async function bankCreateCommand(args: ParsedArgs): Promise<void> {
  const name = stringFlag(args.flags, "name");
  if (!name?.trim()) {
    throw new CliError(1, "lqb bank create 需要 --name <名称>。");
  }
  const requestedPath = stringFlag(args.flags, "path");
  const discovery = await readDiscovery();
  await agentStatus(discovery);
  const response = await agentRequest(
    discovery,
    "/api/agent/workspaces/create",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        ...(requestedPath ? { path: path.resolve(requestedPath) } : {}),
        copySettingsFromCurrent: true,
        chapters: [],
        switch: args.flags.has("switch")
      })
    }
  );
  const payload = (await response.json().catch(() => null)) as {
    workspacePath?: unknown;
    switched?: unknown;
    snapshot?: unknown;
  } | null;
  if (!response.ok) throw apiError(response.status, payload);
  if (args.flags.has("json")) {
    printJson(payload);
    return;
  }
  const createdPath =
    typeof payload?.workspacePath === "string"
      ? payload.workspacePath
      : "";
  console.log(`已创建题库：${createdPath}`);
  if (payload?.switched === true) {
    console.log("应用已切换到新题库。");
  } else {
    console.log("新题库尚未切换；请在应用中打开它，或重试时加 --switch。");
  }
}

async function undoCommand(
  args: ParsedArgs,
  batchId: string | undefined
): Promise<void> {
  if (!batchId) {
    throw new CliError(1, "lqb import undo 需要批次 ID。");
  }
  const discovery = await readDiscovery();
  const status = await agentStatus(discovery);
  const target = await resolveTarget(discovery, status, args, false);
  const response = await agentRequest(discovery, "/api/agent/undo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      batchId,
      workspacePath: target.workspacePath,
      baseRevision: target.status.revision
    })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw apiError(response.status, payload);
  const summary = payload as AgentUndoSummary;
  if (args.flags.has("json")) {
    printJson(summary);
    return;
  }
  console.log(
    `已撤销批次 ${summary.batchId}：删除 ${summary.counts.deleted} 道 · 恢复 ${summary.counts.restored} 道 · 保留 ${summary.counts.kept} 道 · 清理附件 ${summary.counts.assetsRemoved} 个`
  );
  console.log("请在应用中确认题目列表。");
}

async function listCommand(args: ParsedArgs): Promise<void> {
  const snapshot = await readCurrentBank(args);
  const items = orderItemsByChapter(snapshot.bank.items, snapshot.bank.chapters);
  const bookFilter = stringFlag(args.flags, "book");
  const chapterFilter = stringFlag(args.flags, "chapter");
  if (args.flags.has("tag")) {
    throw new CliError(1, "--tag 已拆分：按考点筛选用 --topic，按题型筛选用 --type。");
  }
  const topicFilter = stringFlag(args.flags, "topic");
  const typeFilter = stringFlag(args.flags, "type");
  const priorityFilter = stringFlag(args.flags, "priority");
  const statusFilter = stringFlag(args.flags, "status");
  const limit = parseLimit(args.flags);
  const filtered = items
    .filter((item) => {
      const summary = summarizeItem(item, snapshot.bank);
      if (
        bookFilter &&
        summary.source?.bookTitle !== bookFilter &&
        summary.source?.bookId !== bookFilter
      ) {
        return false;
      }
      if (
        chapterFilter &&
        summary.chapter?.name !== chapterFilter &&
        summary.chapter?.id !== chapterFilter
      ) {
        return false;
      }
      if (topicFilter && !item.topics.includes(topicFilter)) return false;
      if (typeFilter && !item.questionTypes.includes(typeFilter)) return false;
      if (
        priorityFilter &&
        (priorityFilter === "none"
          ? item.reviewPriority !== null
          : item.reviewPriority !== priorityFilter)
      ) {
        return false;
      }
      if (statusFilter && item.reviewStatus !== statusFilter) return false;
      return true;
    })
    .slice(0, limit)
    .map((item) => summarizeItem(item, snapshot.bank));
  if (args.flags.has("json")) {
    printJson(filtered);
    return;
  }
  for (const item of filtered) {
    const source = item.source
      ? `${item.source.bookTitle ?? "无书目"} ${item.source.label}`
      : "无来源";
    const chapter = item.chapter?.name ?? "未分类";
    console.log(
      `${item.id}\t${source}\t${chapter}\t${item.reviewPriority ?? "未标记"}\t${item.reviewStatus}`
    );
  }
  console.log(`共 ${filtered.length} 道（上限 ${limit}）。`);
}

async function searchCommand(
  args: ParsedArgs,
  query: string
): Promise<void> {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    throw new CliError(1, "lqb search 需要搜索词。");
  }
  const snapshot = await readCurrentBank(args);
  const limit = parseLimit(args.flags);
  const results = orderItemsByChapter(snapshot.bank.items, snapshot.bank.chapters)
    .filter((item) => searchText(item, snapshot.bank).includes(normalizedQuery))
    .slice(0, limit)
    .map((item) => summarizeItem(item, snapshot.bank));
  if (args.flags.has("json")) {
    printJson(results);
    return;
  }
  for (const item of results) {
    console.log(
      `${item.id}\t${item.source?.label ?? "无来源"}\t${item.chapter?.name ?? "未分类"}`
    );
  }
  console.log(`共 ${results.length} 道（上限 ${limit}）。`);
}

async function getCommand(
  args: ParsedArgs,
  id: string | undefined
): Promise<void> {
  if (!id) throw new CliError(1, "lqb get 需要题目 ID。");
  const snapshot = await readCurrentBank(args);
  const item = snapshot.bank.items.find((candidate) => candidate.id === id);
  if (!item) throw new CliError(1, `找不到题目：${id}`);
  const book = item.source?.bookId
    ? snapshot.bank.books.find((candidate) => candidate.id === item.source?.bookId)
    : null;
  const chapter = item.chapterId
    ? snapshot.bank.chapters.find((candidate) => candidate.id === item.chapterId)
    : null;
  printJson({
    ...item,
    bookTitle: book?.title ?? null,
    chapterName: chapter?.name ?? null
  });
}

async function bookListCommand(args: ParsedArgs): Promise<void> {
  const snapshot = await readCurrentBank(args);
  const books = snapshot.bank.books.map((book) => ({
    id: book.id,
    title: book.title,
    filePath: book.filePath,
    fileHash: book.fileHash,
    answerBookPath: book.answerBookPath,
    answerBookHash: book.answerBookHash,
    itemCount: snapshot.bank.items.filter(
      (item) => item.source?.bookId === book.id
    ).length
  }));
  if (args.flags.has("json")) {
    printJson(books);
    return;
  }
  for (const book of books) {
    console.log(`${book.title}\t${book.itemCount} 题\t${book.id}`);
  }
}

async function batchListCommand(args: ParsedArgs): Promise<void> {
  const snapshot = await readCurrentBank(args);
  const batches = [...snapshot.bank.imports].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt)
  );
  if (args.flags.has("json")) {
    printJson(batches);
    return;
  }
  for (const batch of batches) {
    console.log(
      `${batch.id}\t${batch.createdAt}\t新增 ${batch.newCount} · 更新 ${batch.updatedCount} · 冲突 ${batch.conflictCount}\t${batch.status}`
    );
  }
}

// lqb topic 与 lqb type 共用同一套子命令，只是整理的字段不同。
const FIELD_COMMANDS: Record<AgentTagField, string> = {
  topics: "topic",
  questionTypes: "type"
};

async function fieldCommand(
  field: AgentTagField,
  args: ParsedArgs,
  rest: string[]
): Promise<void> {
  const [action, ...params] = rest;
  switch (action) {
    case "list":
      return fieldListCommand(field, args);
    case "apply":
      return fieldApplyCommand(field, args);
    case "rename":
      return fieldRenameCommand(field, args, params);
    case "delete":
      return fieldDeleteCommand(field, args, params);
    case "undo":
      return fieldUndoCommand(field, args, params);
    default:
      throw new CliError(
        1,
        `用法：lqb ${FIELD_COMMANDS[field]} list | apply | rename | delete | undo（见 lqb --help）。`
      );
  }
}

async function fieldListCommand(
  field: AgentTagField,
  args: ParsedArgs
): Promise<void> {
  const snapshot = await readCurrentBank(args);
  const counts = new Map<string, number>();
  for (const item of snapshot.bank.items) {
    for (const value of item[field]) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const values = [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort(
      (left, right) =>
        right.count - left.count || left.value.localeCompare(right.value, "zh-Hans-CN")
    );
  if (args.flags.has("json")) {
    printJson(values);
    return;
  }
  for (const { value, count } of values) console.log(`${count}\t${value}`);
  console.log(`共 ${values.length} 个${AGENT_TAG_FIELD_LABELS[field]}。`);
}

async function fieldApplyCommand(
  field: AgentTagField,
  args: ParsedArgs
): Promise<void> {
  const command = FIELD_COMMANDS[field];
  const file = stringFlag(args.flags, "file");
  if (!file) throw new CliError(1, `lqb ${command} apply 需要 --file <changes.json>。`);
  const raw = await readJsonFile(file, "整理清单");
  // 清单可以不写 field，由命令决定；写了就必须和命令一致，避免把考点清单误用到题型上。
  if (raw && typeof raw === "object" && !Array.isArray(raw) && "field" in raw) {
    if (raw.field !== field) {
      throw new CliError(
        2,
        `清单的 field 是 ${String(raw.field)}，与 lqb ${command}（${field}）不一致。`
      );
    }
  }
  const manifest = parseTagManifest(
    raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw, field } : raw
  );
  await submitTagManifest(args, manifest);
}

async function fieldRenameCommand(
  field: AgentTagField,
  args: ParsedArgs,
  params: string[]
): Promise<void> {
  const noun = AGENT_TAG_FIELD_LABELS[field];
  if (params.length !== 2) {
    throw new CliError(1, `lqb ${FIELD_COMMANDS[field]} rename 需要 <旧${noun}> <新${noun}>。`);
  }
  const [from, to] = params;
  await submitTagManifest(
    args,
    parseTagManifest({ schemaVersion: 1, field, renames: [{ from, to }] })
  );
}

async function fieldDeleteCommand(
  field: AgentTagField,
  args: ParsedArgs,
  params: string[]
): Promise<void> {
  if (params.length !== 1) {
    throw new CliError(
      1,
      `lqb ${FIELD_COMMANDS[field]} delete 需要 <${AGENT_TAG_FIELD_LABELS[field]}>。`
    );
  }
  await submitTagManifest(
    args,
    parseTagManifest({ schemaVersion: 1, field, deletions: [params[0]] })
  );
}

async function fieldUndoCommand(
  field: AgentTagField,
  args: ParsedArgs,
  params: string[]
): Promise<void> {
  const command = FIELD_COMMANDS[field];
  if (params.length !== 1) {
    throw new CliError(1, `lqb ${command} undo 需要撤销文件路径。`);
  }
  const validation = validateAgentTagJournal(
    await readJsonFile(params[0], "撤销记录")
  );
  if (!validation.ok || !validation.value) {
    throw new CliError(2, validation.error ?? "撤销记录无效。");
  }
  if (validation.value.field !== field) {
    throw new CliError(
      2,
      `这份撤销记录整理的是${AGENT_TAG_FIELD_LABELS[validation.value.field]}，请用 lqb ${FIELD_COMMANDS[validation.value.field]} undo。`
    );
  }
  const summary = await postTagRequest<AgentTagUndoSummary>(
    args,
    "/api/agent/tags/undo",
    { journal: validation.value }
  );
  if (args.flags.has("json")) {
    printJson(summary);
  } else {
    printTagUndoSummary(summary);
  }
  if (summary.counts.conflicts > 0) process.exitCode = 3;
}

async function submitTagManifest(
  args: ParsedArgs,
  manifest: AgentTagManifest
): Promise<void> {
  const dryRun = args.flags.has("dry-run");
  const undoDir = path.join(
    process.cwd(),
    ".lqb",
    `${FIELD_COMMANDS[manifest.field]}-undo`
  );
  if (!dryRun) {
    // 写入之后才发现撤销文件存不下就晚了，所以先确认目录可写。
    try {
      await mkdir(undoDir, { recursive: true });
      await access(undoDir, constants.W_OK);
    } catch {
      throw new CliError(1, `无法写入撤销文件目录：${undoDir}`);
    }
  }
  const { journal, ...summary } = await postTagRequest<AgentTagSummary>(
    args,
    "/api/agent/tags",
    { manifest }
  );
  const undoFile = journal ? await writeTagJournal(undoDir, journal) : null;
  if (args.flags.has("json")) {
    printJson({ ...summary, undoFile });
  } else {
    printTagSummary(summary, undoFile);
  }
}

async function postTagRequest<T>(
  args: ParsedArgs,
  pathname: string,
  body: Record<string, unknown>
): Promise<T> {
  return postAgentWrite(args, pathname, body, "lqb topic/type");
}

async function postAgentWrite<T>(
  args: ParsedArgs,
  pathname: string,
  body: Record<string, unknown>,
  commandName: string
): Promise<T> {
  const discovery = await readDiscovery();
  const status = await agentStatus(discovery);
  const target = await resolveTarget(discovery, status, args, false);
  const response = await agentRequest(discovery, pathname, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...body,
      workspacePath: target.workspacePath,
      baseRevision: target.status.revision,
      dryRun: args.flags.has("dry-run")
    })
  });
  if (response.status === 404) {
    throw new CliError(1, `当前运行的应用不支持 ${commandName}，请更新并重启应用。`);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw apiError(response.status, payload);
  return payload as T;
}

async function imageNormalizeCommand(args: ParsedArgs): Promise<void> {
  const summary = await postAgentWrite<AgentImageNormalizeSummary>(
    args,
    "/api/agent/images/normalize",
    {},
    "lqb image normalize"
  );
  if (args.flags.has("json")) {
    printJson(summary);
    return;
  }
  const verb = summary.dryRun ? "将改写" : "已改写";
  console.log(
    `${verb} ${summary.counts.items} 道题中的 ${summary.counts.images} 张旧图片为 \\qimg。`
  );
  for (const change of summary.changes) {
    console.log(`- ${change.source}（${change.module}）${change.path} → \\qimg[${change.size}]`);
  }
  for (const warning of summary.warnings) {
    console.log(`! ${warning.source}：读不到 ${warning.path} 的尺寸，保持原样。`);
  }
  if (!summary.dryRun && summary.counts.images > 0) {
    console.log("改写前已在 .history/ 留快照，可在应用的恢复入口回到改写前。");
  }
}

async function writeTagJournal(
  dir: string,
  journal: AgentTagJournal
): Promise<string | null> {
  const fileName = `${journal.createdAt.replace(/[:.]/g, "-")}-${randomBytes(2).toString("hex")}.json`;
  const filePath = path.join(dir, fileName);
  try {
    await writeFile(filePath, `${JSON.stringify(journal, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx"
    });
    return filePath;
  } catch (error) {
    // 题库已经改了，撤销记录不能丢：写不进文件就整份打印出来。
    console.error(
      `警告：${AGENT_TAG_FIELD_LABELS[journal.field]}已修改，但撤销文件写入失败（${error instanceof Error ? error.message : "未知错误"}）。请保存下面的撤销记录：`
    );
    console.error(JSON.stringify(journal));
    process.exitCode = 1;
    return null;
  }
}

function parseTagManifest(value: unknown): AgentTagManifest {
  const validation = validateAgentTagManifest(value);
  if (!validation.ok || !validation.value) {
    throw new CliError(2, validation.error ?? "整理清单无效。");
  }
  return validation.value;
}

async function readJsonFile(file: string, label: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path.resolve(file), "utf8")) as unknown;
  } catch (error) {
    throw new CliError(
      2,
      `读取${label}失败：${error instanceof Error ? error.message : file}`
    );
  }
}

function formatValues(values: string[]): string {
  return values.length ? values.join("、") : "（无）";
}

function printTagSummary(
  summary: Omit<AgentTagSummary, "journal">,
  undoFile: string | null
): void {
  const { counts } = summary;
  const noun = AGENT_TAG_FIELD_LABELS[summary.field];
  const unchanged = counts.unchanged ? ` · 无需修改 ${counts.unchanged} 道` : "";
  console.log(
    `${summary.dryRun ? "Dry-run 通过（题库未改动）" : `${noun}已更新`}：修改 ${counts.changed} 道 · 新增 ${counts.added} 个${noun} · 移除 ${counts.removed} 个${noun}${unchanged}`
  );
  for (const change of summary.changes) {
    console.log(
      `  ${change.source}（${change.id}）：${formatValues(change.before)} → ${formatValues(change.after)}`
    );
  }
  for (const warning of summary.warnings) console.log(`警告：${warning.message}`);
  if (undoFile) {
    console.log(`撤销文件：${undoFile}`);
    console.log(`撤销命令：lqb ${FIELD_COMMANDS[summary.field]} undo "${undoFile}"`);
  }
  if (!summary.dryRun && counts.changed === 0) {
    console.log(`没有需要修改的${noun}，题库未改动。`);
  }
}

function printTagUndoSummary(summary: AgentTagUndoSummary): void {
  const { counts } = summary;
  const noun = AGENT_TAG_FIELD_LABELS[summary.field];
  console.log(
    `${summary.dryRun ? "Dry-run 通过（题库未改动）" : `${noun}已恢复`}：恢复 ${counts.restored} 道 · 已是原状 ${counts.unchanged} 道 · 未恢复 ${counts.conflicts} 道`
  );
  for (const change of summary.restored) {
    console.log(
      `  ${change.source}（${change.id}）：${formatValues(change.before)} → ${formatValues(change.after)}`
    );
  }
  for (const conflict of summary.conflicts) {
    console.log(
      conflict.reason === "missing"
        ? `未恢复（题目已删除）：${conflict.id}`
        : `未恢复（${noun}之后又被改动）：${conflict.source}（${conflict.id}）`
    );
  }
}

async function readCurrentBank(args: ParsedArgs): Promise<BankSnapshot> {
  const discovery = await readDiscovery();
  const status = await agentStatus(discovery);
  const target = await resolveTarget(discovery, status, args, false);
  const response = await fetch(
    `http://127.0.0.1:${discovery.port}/api/bank`
  );
  if (!response.ok) {
    throw apiError(response.status, await response.json().catch(() => null));
  }
  const snapshot = (await response.json()) as BankSnapshot;
  if (path.resolve(snapshot.workspacePath) !== path.resolve(target.workspacePath)) {
    throw new CliError(
      4,
      `当前应用题库已变化：${snapshot.workspacePath}。请重新运行 lqb link。`
    );
  }
  return snapshot;
}

async function resolveTarget(
  discovery: AgentDiscovery,
  status: AgentStatus,
  args: ParsedArgs,
  allowSwitch: boolean
): Promise<{ workspacePath: string; status: AgentStatus }> {
  const link = await readLink();
  const workspacePathValue =
    stringFlag(args.flags, "workspace") ??
    link?.workspacePath ??
    status.workspacePath;
  if (!workspacePathValue) {
    throw new CliError(4, "没有目标题库，请先打开题库或运行 lqb link。");
  }
  const workspacePath = path.resolve(workspacePathValue);
  if (workspacePath === path.resolve(status.workspacePath)) {
    return { workspacePath, status };
  }
  if (allowSwitch && args.flags.has("switch")) {
    const response = await agentRequest(
      discovery,
      "/api/agent/workspaces/switch",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspacePath })
      }
    );
    if (!response.ok) {
      throw apiError(response.status, await response.json().catch(() => null));
    }
    return {
      workspacePath,
      status: await agentStatus(discovery)
    };
  }
  throw new CliError(
    4,
    `目标题库不是当前打开的工作区：${workspacePath}\n请先在应用中切换，或加 --switch。`
  );
}

async function readDiscovery(): Promise<AgentDiscovery> {
  const filePath = discoveryPath();
  let value: unknown;
  try {
    value = JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    throw new CliError(
      5,
      `未找到 Agent 连接信息：${filePath}\n请先启动 LaTeX 题库。`
    );
  }
  if (
    typeof value !== "object" ||
    value === null ||
    (value as { version?: unknown }).version !== 1 ||
    typeof (value as { port?: unknown }).port !== "number" ||
    typeof (value as { token?: unknown }).token !== "string" ||
    typeof (value as { workspacePath?: unknown }).workspacePath !== "string"
  ) {
    throw new CliError(5, "Agent 连接信息无效，请重启应用。");
  }
  return value as AgentDiscovery;
}

async function readLink(): Promise<LinkInfo | null> {
  try {
    const value = JSON.parse(
      await readFile(path.join(process.cwd(), ".lqb.json"), "utf8")
    ) as Partial<LinkInfo>;
    if (value.version !== 1 || typeof value.workspacePath !== "string") {
      throw new Error();
    }
    return value as LinkInfo;
  } catch {
    return null;
  }
}

async function agentStatus(
  discovery: AgentDiscovery
): Promise<AgentStatus> {
  let response: Response;
  try {
    response = await agentRequest(discovery, "/api/agent/status");
  } catch {
    throw new CliError(5, "无法连接应用，请确认 LaTeX 题库正在运行。");
  }
  if (!response.ok) {
    throw apiError(response.status, await response.json().catch(() => null));
  }
  return (await response.json()) as AgentStatus;
}

async function agentRequest(
  discovery: AgentDiscovery,
  pathname: string,
  init: RequestInit = {}
): Promise<Response> {
  return fetch(`http://127.0.0.1:${discovery.port}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${discovery.token}`,
      ...(init.headers as Record<string, string> | undefined)
    }
  });
}

function discoveryPath(): string {
  const override = process.env.LQB_AGENT_DISCOVERY_FILE?.trim();
  return override
    ? path.resolve(override)
    : path.join(os.homedir(), ".lqb", "agent.json");
}

function apiError(status: number, payload: unknown): CliError {
  const record =
    typeof payload === "object" && payload !== null
      ? (payload as { code?: unknown; error?: unknown })
      : {};
  const code = typeof record.code === "string" ? record.code : "";
  const message =
    typeof record.error === "string" ? record.error : `请求失败（${status}）。`;
  if (status === 401) return new CliError(5, message);
  if (code === "WORKSPACE_CHANGED") return new CliError(4, message);
  if (code === "BANK_CONFLICT") return new CliError(3, message);
  if (
    code === "UNDO_BATCH_NOT_FOUND" ||
    code === "UNDO_BATCH_ALREADY_UNDONE" ||
    code === "UNDO_SNAPSHOT_MISSING" ||
    code === "UNDO_SNAPSHOT_INVALID" ||
    code === "UNDO_CONFLICT"
  ) {
    return new CliError(6, message);
  }
  if (status === 400) return new CliError(2, message);
  return new CliError(1, message);
}

function applyBatchFlag(
  manifest: AgentImportManifest,
  batchId: string | undefined
): void {
  if (!batchId) return;
  if (manifest.batch?.id && manifest.batch.id !== batchId) {
    throw new CliError(2, "清单已有 batch.id，与 --batch-id 不一致。");
  }
  manifest.batch = { ...manifest.batch, id: batchId };
}

async function resolveBookPaths(
  manifest: AgentImportManifest,
  manifestDir: string
): Promise<void> {
  for (const book of manifest.books ?? []) {
    for (const [pathKey, hashKey] of [
      ["filePath", "fileHash"],
      ["answerBookPath", "answerBookHash"]
    ] as const) {
      const value = book[pathKey];
      if (!value) continue;
      const resolved = path.resolve(manifestDir, value);
      book[pathKey] = resolved;
      if (!book[hashKey]) {
        try {
          const buffer = await readFile(resolved);
          book[hashKey] = createHash("sha256").update(buffer).digest("hex");
        } catch {
          console.warn(`无法读取书目文件，跳过哈希：${resolved}`);
        }
      }
    }
  }
}

function printImportSummary(summary: AgentImportSummary, json: boolean): void {
  if (json) {
    printJson(summary);
    return;
  }
  if (summary.createdWorkspace) {
    console.log(
      `${summary.dryRun ? "将创建题库" : "已创建题库"}：${summary.createdWorkspace.path}${
        summary.createdWorkspace.switched ? "（已切换）" : ""
      }`
    );
  }
  console.log(
    `${summary.dryRun ? "Dry-run 通过" : "导入完成"}：新增 ${summary.counts.created} · 更新 ${summary.counts.updated} · 冲突 ${summary.counts.conflicts} · 附件 ${summary.counts.assets}`
  );
  if (summary.batchId) console.log(`批次 ID：${summary.batchId}`);
  for (const conflict of summary.conflicts) {
    console.log(`冲突（已审阅，未覆盖）：${conflict.source}`);
  }
  for (const warning of summary.warnings) {
    console.log(`警告：${warning.message}${warning.question ? `（${warning.question}）` : ""}`);
  }
  if (
    !summary.dryRun &&
    summary.createdWorkspace &&
    !summary.createdWorkspace.switched
  ) {
    console.log("新题库尚未切换；请在应用中打开它，或下次使用 --switch。");
  }
  if (!summary.dryRun) {
    console.log("请在应用的「待审阅」页检查导入内容。");
  }
}

function summarizeItem(item: QuestionItem, bank: Bank) {
  const book = item.source?.bookId
    ? bank.books.find((candidate) => candidate.id === item.source?.bookId)
    : null;
  const chapter = item.chapterId
    ? bank.chapters.find((candidate) => candidate.id === item.chapterId)
    : null;
  return {
    id: item.id,
    source: item.source
      ? {
          bookId: book?.id ?? null,
          bookTitle: book?.title ?? null,
          label: item.source.label
        }
      : null,
    chapter: chapter
      ? { id: chapter.id, name: chapter.name }
      : null,
    topics: item.topics,
    questionTypes: item.questionTypes,
    reviewPriority: item.reviewPriority,
    reviewStatus: item.reviewStatus,
    variantOf: item.variantOf,
    question: item.modules.question.tex.slice(0, 300)
  };
}

function searchText(item: QuestionItem, bank: Bank): string {
  const book = item.source?.bookId
    ? bank.books.find((candidate) => candidate.id === item.source?.bookId)
    : null;
  return [
    book?.title,
    item.source?.label,
    item.topics.join(" "),
    item.questionTypes.join(" "),
    item.modules.question.tex,
    item.modules.solution.tex,
    item.modules.note.tex
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
}

function parseLimit(flags: Map<string, string | boolean>): number {
  const raw = stringFlag(flags, "limit");
  if (!raw) return 50;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new CliError(1, "--limit 必须是正整数。");
  }
  return Math.min(value, 200);
}

function imageMime(filePath: string): string | null {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  return null;
}

function stringFlag(
  flags: Map<string, string | boolean>,
  name: string
): string | undefined {
  const value = flags.get(name);
  return typeof value === "string" ? value : undefined;
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | boolean>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      positionals.push(argument);
      continue;
    }
    const [name, inline] = argument.slice(2).split("=", 2);
    if (inline !== undefined) {
      flags.set(name, inline);
      continue;
    }
    if (VALUE_FLAGS.has(name)) {
      const value = argv[index + 1];
      if (!value) throw new CliError(1, `--${name} 需要值。`);
      flags.set(name, value);
      index += 1;
      continue;
    }
    flags.set(name, true);
  }
  return { positionals, flags };
}

function printHelp(): void {
  console.log(`lqb — LaTeX 题库本地 Agent CLI

用法：
  lqb status [--json]
  lqb link [--workspace <path>] [--json]
  lqb agent-init [--dir <path>] [--force]
  lqb import --file <manifest.json> [--dry-run] [--overwrite] [--switch] [--batch-id <id>] [--create-bank] [--json]
  lqb import undo <batchId> [--json]
  lqb bank create --name <name> [--path <path>] [--switch] [--json]
  lqb list [--book <title>] [--chapter <name>] [--topic <考点>] [--type <题型>] [--priority <p>] [--status <s>] [--limit <n>] [--json]
  lqb search <query> [--limit <n>] [--json]
  lqb get <id> [--json]
  lqb book list [--json]
  lqb batch list [--json]
  lqb topic list [--json]
  lqb topic apply --file <changes.json> [--dry-run] [--json]
  lqb topic rename <旧考点> <新考点> [--dry-run] [--json]
  lqb topic delete <考点> [--dry-run] [--json]
  lqb topic undo <撤销文件> [--dry-run] [--json]
  lqb type list | apply | rename | delete | undo（用法同 lqb topic，整理题型）
  lqb image normalize [--dry-run] [--json]   把旧的固定 0.75 栏宽图片按尺寸改写为 \\qimg
  lqb manifest example

导入前请先运行 lqb status 和 lqb link，并保持桌面应用运行。
整书导入默认新建题库但不切换；加 --switch 才会切换当前题库。`);
}

main().catch((error) => {
  const message =
    error instanceof Error ? error.message : "lqb 执行失败。";
  console.error(message);
  process.exitCode = error instanceof CliError ? error.exitCode : 1;
});
