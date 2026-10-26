import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
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
  expect(emptyBank.version).toBe(3);
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

async function runCli(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--import", tsxLoader, cliScript, ...args],
    {
      cwd: agentDir,
      env: cliEnv,
      timeout: 30_000
    }
  );
  return stdout;
}
