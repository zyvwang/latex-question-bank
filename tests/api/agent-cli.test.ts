import { execFile } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import type {
  AgentTagJournal,
  AgentTagSummary,
  AgentTagUndoSummary
} from "../../shared/agent-tags.js";
import type { Bank } from "../../shared/types.js";
import { refreshAgentDiscovery } from "../../server/agent-discovery.js";
import { appDataDir } from "../../server/app-state.js";
import {
  startApiServer,
  type StartedApiServer
} from "../../server/index.js";

const execFileAsync = promisify(execFile);
const workspacePath = path.resolve(".tmp/vitest-cli-workspace");
const agentDir = path.resolve(".tmp/vitest-cli-agent");
const discoveryFile = path.resolve(".tmp/vitest-cli-agent.json");
const tsxLoader = pathToFileURL(
  path.resolve("node_modules/tsx/dist/loader.mjs")
).href;
const cliScript = path.resolve("cli/lqb.ts");
let server: StartedApiServer;
let cliEnv: NodeJS.ProcessEnv;

beforeAll(async () => {
  process.env.LQB_AGENT_DISCOVERY_FILE = discoveryFile;
  server = await startApiServer({ port: 0, appVersion: "test" });
  cliEnv = {
    ...process.env,
    LQB_AGENT_DISCOVERY_FILE: discoveryFile
  };
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.server.close(() => resolve()));
  delete process.env.LQB_AGENT_DISCOVERY_FILE;
  await rm(discoveryFile, { force: true });
});

beforeEach(async () => {
  await rm(appDataDir, { recursive: true, force: true });
  await rm(workspacePath, { recursive: true, force: true });
  await rm(agentDir, { recursive: true, force: true });
  await mkdir(agentDir, { recursive: true });
  const response = await fetch(`${server.url}/api/workspaces/create-sample`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspacePath })
  });
  expect(response.ok).toBe(true);
  await refreshAgentDiscovery(workspacePath);
});

it("creates a bank, imports a whole book, and undoes a batch from the CLI", async () => {
  const createdBankPath = path.join(agentDir, "cli-created-bank");
  const created = JSON.parse(
    await runCli([
      "bank",
      "create",
      "--name",
      "CLI 书",
      "--path",
      createdBankPath,
      "--json"
    ])
  ) as { workspacePath: string; switched: boolean };
  expect(created.workspacePath).toBe(createdBankPath);
  expect(created.switched).toBe(false);
  const emptyBank = JSON.parse(
    await readFile(path.join(createdBankPath, "bank.json"), "utf8")
  ) as Bank;
  expect(emptyBank.version).toBe(4);
  expect(emptyBank.items).toHaveLength(0);

  await writeFile(
    path.join(agentDir, "book.json"),
    JSON.stringify({
      schemaVersion: 1,
      batch: { id: "cli-book-batch", note: "CLI 整书导入" },
      bank: { name: "CLI 整书", path: "cli-book" },
      chapters: [{ name: "第一章" }],
      books: [{ title: "CLI 书" }],
      questions: [
        {
          source: { bookTitle: "CLI 书", label: "1.1" },
          chapterName: "第一章",
          modules: {
            question: { tex: "CLI 导入的题目。" },
            solution: { tex: "" }
          },
          solutionSource: "none"
        }
      ]
    }),
    "utf8"
  );
  const imported = JSON.parse(
    await runCli([
      "import",
      "--file",
      "book.json",
      "--create-bank",
      "--json"
    ])
  ) as {
    batchId: string;
    createdWorkspace: { path: string; switched: boolean };
    counts: { created: number };
  };
  expect(imported.createdWorkspace).toEqual({
    path: path.join(agentDir, "cli-book"),
    switched: false
  });
  expect(imported.counts.created).toBe(1);
  const bookBank = JSON.parse(
    await readFile(path.join(agentDir, "cli-book", "bank.json"), "utf8")
  ) as Bank;
  expect(bookBank.items).toHaveLength(1);
  expect(bookBank.items[0].reviewStatus).toBe("pending");

  await writeFile(
    path.join(agentDir, "single.json"),
    JSON.stringify({
      schemaVersion: 1,
      batch: { id: "cli-undo-batch", note: "CLI 撤销测试" },
      books: [{ title: "CLI 书" }],
      questions: [
        {
          source: { bookTitle: "CLI 书", label: "2.1" },
          chapterName: "微积分/极限",
          modules: { question: { tex: "待撤销的题目。" } },
          solutionSource: "none"
        }
      ]
    }),
    "utf8"
  );
  const single = JSON.parse(
    await runCli(["import", "--file", "single.json", "--json"])
  ) as { batchId: string; counts: { created: number } };
  expect(single.counts.created).toBe(1);
  const undo = JSON.parse(
    await runCli(["import", "undo", single.batchId, "--json"])
  ) as { counts: { deleted: number } };
  expect(undo.counts.deleted).toBe(1);
});

it("lists, previews, applies, and undoes a topic rename from the CLI", async () => {
  const topics = JSON.parse(await runCli(["topic", "list", "--json"])) as Array<{
    value: string;
    count: number;
  }>;
  expect(topics).toContainEqual({ value: "极限", count: 1 });

  const preview = JSON.parse(
    await runCli(["topic", "rename", "极限", "函数极限", "--dry-run", "--json"])
  ) as AgentTagSummary & { undoFile: string | null };
  expect(preview).toMatchObject({
    field: "topics",
    dryRun: true,
    undoFile: null,
    counts: { changed: 1, added: 1, removed: 1 }
  });
  expect(await sampleLabels()).toEqual(INITIAL_LABELS);
  await expect(access(path.join(agentDir, ".lqb", "topic-undo"))).rejects.toThrow();

  const applied = JSON.parse(
    await runCli(["topic", "rename", "极限", "函数极限", "--json"])
  ) as AgentTagSummary & { undoFile: string };
  expect(applied.dryRun).toBe(false);
  expect(applied).not.toHaveProperty("journal");
  expect(path.dirname(applied.undoFile)).toBe(
    path.join(agentDir, ".lqb", "topic-undo")
  );
  const journal = JSON.parse(
    await readFile(applied.undoFile, "utf8")
  ) as AgentTagJournal;
  expect(journal.field).toBe("topics");
  expect(journal.entries).toEqual([
    {
      id: "sample-limit",
      before: ["极限", "等价无穷小"],
      after: ["函数极限", "等价无穷小"]
    }
  ]);
  // 只动考点，题型保持原样。
  expect(await sampleLabels()).toEqual([
    { topics: ["函数极限", "等价无穷小"], questionTypes: ["解答"] },
    INITIAL_LABELS[1]
  ]);

  const text = await runCli(["topic", "undo", applied.undoFile, "--dry-run"]);
  expect(text).toContain("恢复 1 道");

  const wrongCommand = await runCliExpectingFailure(["type", "undo", applied.undoFile]);
  expect(wrongCommand.code).toBe(2);
  expect(wrongCommand.stderr).toContain("lqb topic undo");

  const undone = JSON.parse(
    await runCli(["topic", "undo", applied.undoFile, "--json"])
  ) as AgentTagUndoSummary;
  expect(undone.field).toBe("topics");
  expect(undone.counts).toEqual({ restored: 1, unchanged: 0, conflicts: 0 });
  expect(await sampleLabels()).toEqual(INITIAL_LABELS);
});

it("applies a question type change file and maps failures to exit codes", async () => {
  await writeFile(
    path.join(agentDir, "types.json"),
    JSON.stringify({
      schemaVersion: 1,
      note: "题型归类",
      changes: [{ id: "sample-linear-algebra", add: ["选择"], remove: ["填空"] }]
    }),
    "utf8"
  );
  const text = await runCli(["type", "apply", "--file", "types.json"]);
  expect(text).toContain("题型已更新：修改 1 道");
  expect(text).toContain("填空 → 选择");
  expect(text).toContain("撤销命令：lqb type undo");
  expect(await sampleLabels()).toEqual([
    INITIAL_LABELS[0],
    { topics: ["矩阵", "行列式"], questionTypes: ["选择"] }
  ]);
  const types = JSON.parse(await runCli(["type", "list", "--json"])) as Array<{
    value: string;
    count: number;
  }>;
  expect(types).toEqual([
    { value: "解答", count: 1 },
    { value: "选择", count: 1 }
  ]);

  // 清单写了 field 就必须和命令一致。
  await writeFile(
    path.join(agentDir, "mismatch.json"),
    JSON.stringify({
      schemaVersion: 1,
      field: "topics",
      changes: [{ id: "sample-limit", add: ["证明"] }]
    }),
    "utf8"
  );
  const mismatch = await runCliExpectingFailure(["type", "apply", "--file", "mismatch.json"]);
  expect(mismatch.code).toBe(2);
  expect(mismatch.stderr).toContain("不一致");

  await writeFile(
    path.join(agentDir, "unknown.json"),
    JSON.stringify({
      schemaVersion: 1,
      changes: [{ id: "no-such-question", add: ["x"] }]
    }),
    "utf8"
  );
  const unknown = await runCliExpectingFailure([
    "topic",
    "apply",
    "--file",
    "unknown.json"
  ]);
  expect(unknown.code).toBe(2);
  expect(unknown.stderr).toContain("no-such-question");

  await writeFile(
    path.join(agentDir, "invalid.json"),
    JSON.stringify({ schemaVersion: 1, changes: [{ id: "x", add: ["待审阅"] }] }),
    "utf8"
  );
  expect(
    (await runCliExpectingFailure(["topic", "apply", "--file", "invalid.json"])).code
  ).toBe(2);
  expect(
    (await runCliExpectingFailure(["topic", "apply", "--file", "missing.json"])).code
  ).toBe(2);
  expect(await sampleLabels()).toEqual([
    INITIAL_LABELS[0],
    { topics: ["矩阵", "行列式"], questionTypes: ["选择"] }
  ]);
});

it("filters lqb list by topic and question type", async () => {
  const byTopic = JSON.parse(
    await runCli(["list", "--topic", "矩阵", "--json"])
  ) as Array<{ id: string; topics: string[]; questionTypes: string[] }>;
  expect(byTopic.map((item) => item.id)).toEqual(["sample-linear-algebra"]);
  expect(byTopic[0]).toMatchObject({ topics: ["矩阵", "行列式"], questionTypes: ["填空"] });
  expect(byTopic[0]).not.toHaveProperty("tags");
  const byType = JSON.parse(
    await runCli(["list", "--type", "解答", "--json"])
  ) as Array<{ id: string }>;
  expect(byType.map((item) => item.id)).toEqual(["sample-limit"]);
  const legacyFlag = await runCliExpectingFailure(["list", "--tag", "极限"]);
  expect(legacyFlag.code).toBe(1);
  expect(legacyFlag.stderr).toContain("--topic");
});

it("exits 3 when an undo cannot restore questions edited afterwards", async () => {
  const applied = JSON.parse(
    await runCli(["topic", "rename", "矩阵", "线性代数", "--json"])
  ) as { undoFile: string };

  const current = (await (await fetch(`${server.url}/api/bank`)).json()) as {
    revision: string;
    bank: Bank;
  };
  const response = await fetch(`${server.url}/api/bank`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspacePath,
      baseRevision: current.revision,
      bank: {
        ...current.bank,
        items: current.bank.items.map((item) =>
          item.id === "sample-linear-algebra"
            ? { ...item, topics: [...item.topics, "用户后加"] }
            : item
        )
      }
    })
  });
  expect(response.ok).toBe(true);

  const failure = await runCliExpectingFailure(["topic", "undo", applied.undoFile]);
  expect(failure.code).toBe(3);
  expect(failure.stdout).toContain("未恢复（考点之后又被改动）");
  expect(await sampleLabels()).toEqual([
    INITIAL_LABELS[0],
    { topics: ["线性代数", "行列式", "用户后加"], questionTypes: ["填空"] }
  ]);
});

it("explains when the running app is too old to support lqb topic", async () => {
  const stub = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/api/agent/status") {
      response.end(
        JSON.stringify({
          appVersion: "0.3.2",
          workspacePath,
          workspaceName: "stub",
          setupRequired: false,
          revision: "revision",
          pendingCount: 0,
          books: []
        })
      );
      return;
    }
    response.statusCode = 404;
    response.end("{}");
  });
  stub.listen(0, "127.0.0.1");
  await once(stub, "listening");
  const stubDiscovery = path.resolve(".tmp/vitest-cli-stub-agent.json");
  await writeFile(
    stubDiscovery,
    JSON.stringify({
      version: 1,
      port: (stub.address() as AddressInfo).port,
      token: "stub-token",
      workspacePath,
      pid: process.pid
    }),
    "utf8"
  );
  try {
    const failure = await runCliExpectingFailure(
      ["topic", "rename", "a", "b", "--dry-run"],
      { LQB_AGENT_DISCOVERY_FILE: stubDiscovery }
    );
    expect(failure.code).toBe(1);
    expect(failure.stderr).toContain("不支持 lqb topic/type");
  } finally {
    await new Promise<void>((resolve) => stub.close(() => resolve()));
    await rm(stubDiscovery, { force: true });
  }
});

it("reports topic/type command usage errors with exit code 1", async () => {
  for (const args of [
    ["topic"],
    ["topic", "unknown"],
    ["topic", "rename", "只有一个"],
    ["type", "delete"],
    ["type", "undo"],
    ["type", "apply"]
  ]) {
    expect((await runCliExpectingFailure(args)).code).toBe(1);
  }
  const removed = await runCliExpectingFailure(["tag", "list"]);
  expect(removed.code).toBe(1);
  expect(removed.stderr).toContain("lqb topic");
  const same = await runCliExpectingFailure(["type", "rename", "A", "A"]);
  expect(same.code).toBe(2);
});

const INITIAL_LABELS = [
  { topics: ["极限", "等价无穷小"], questionTypes: ["解答"] },
  { topics: ["矩阵", "行列式"], questionTypes: ["填空"] }
];

async function sampleLabels(): Promise<Array<{ topics: string[]; questionTypes: string[] }>> {
  const bank = JSON.parse(
    await readFile(path.join(workspacePath, "bank.json"), "utf8")
  ) as Bank;
  return bank.items.map(({ topics, questionTypes }) => ({ topics, questionTypes }));
}

async function runCliExpectingFailure(
  args: string[],
  env: NodeJS.ProcessEnv = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    await runCli(args, env);
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return {
      code: typeof failure.code === "number" ? failure.code : -1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? ""
    };
  }
  throw new Error(`expected "lqb ${args.join(" ")}" to fail`);
}

async function runCli(
  args: string[],
  env: NodeJS.ProcessEnv = {}
): Promise<string> {
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--import", tsxLoader, cliScript, ...args],
    {
      cwd: agentDir,
      env: { ...cliEnv, ...env },
      timeout: 30_000
    }
  );
  return stdout;
}
