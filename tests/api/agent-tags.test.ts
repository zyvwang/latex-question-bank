import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  AgentTagJournal,
  AgentTagManifest
} from "../../shared/agent-tags.js";
import type { Bank } from "../../shared/types.js";
import { getAgentToken } from "../../server/agent-auth.js";
import { appDataDir } from "../../server/app-state.js";
import { createApiApp } from "../../server/index.js";
import { listenLocal, request } from "../fixtures/api-server.js";

const workspacePath = path.resolve(".tmp/vitest-agent-tags-workspace");

beforeEach(async () => {
  await rm(appDataDir, { recursive: true, force: true });
  await rm(workspacePath, { recursive: true, force: true });
});

describe("agent tag API", () => {
  it("requires the agent token on both endpoints", async () => {
    const app = await setup();
    for (const endpoint of ["/api/agent/tags", "/api/agent/tags/undo"]) {
      await request(app)
        .post(endpoint)
        .send({ workspacePath })
        .expect(401)
        .expect(({ body }) => expect(body.code).toBe("AGENT_UNAUTHORIZED"));
    }
  });

  it("previews a change without writing anything", async () => {
    const app = await setup();
    const before = await getBank(app);
    const response = await postTags(app, addTag("sample-limit", "函数极限"), {
      dryRun: true
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      dryRun: true,
      revision: before.revision,
      counts: { changed: 1, unchanged: 0, added: 1, removed: 0 },
      changes: [
        {
          id: "sample-limit",
          source: "示例题库 示例 1",
          before: ["极限", "等价无穷小"],
          after: ["极限", "等价无穷小", "函数极限"]
        }
      ]
    });
    expect(response.body.journal).toBeUndefined();
    const after = await getBank(app);
    expect(after.revision).toBe(before.revision);
    expect(after.bank).toEqual(before.bank);
  });

  it("writes topics only, keeps review state, and takes no history snapshot", async () => {
    const app = await setup();
    const before = await getBank(app);
    const historyBefore = await historyFiles();

    const response = await postTags(app, {
      schemaVersion: 1,
      field: "topics",
      note: "考点归类",
      changes: [
        { id: "sample-limit", add: ["函数极限"], remove: ["等价无穷小"] }
      ]
    });
    expect(response.status).toBe(200);
    expect(response.body.dryRun).toBe(false);
    expect(response.body.counts).toEqual({
      changed: 1,
      unchanged: 0,
      added: 1,
      removed: 1
    });

    const after = await getBank(app);
    expect(response.body.revision).toBe(after.revision);
    expect(after.revision).not.toBe(before.revision);
    const changed = after.bank.items.find((item) => item.id === "sample-limit")!;
    const original = before.bank.items.find((item) => item.id === "sample-limit")!;
    expect(changed.topics).toEqual(["极限", "函数极限"]);
    expect(changed.updatedAt).not.toBe(original.updatedAt);
    expect({ ...changed, topics: original.topics, updatedAt: original.updatedAt }).toEqual(
      original
    );
    expect(
      after.bank.items.find((item) => item.id === "sample-linear-algebra")
    ).toEqual(
      before.bank.items.find((item) => item.id === "sample-linear-algebra")
    );
    expect(after.bank.imports).toEqual(before.bank.imports);
    expect(await historyFiles()).toEqual(historyBefore);

    const journal = response.body.journal as AgentTagJournal;
    expect(journal).toMatchObject({
      schemaVersion: 1,
      field: "topics",
      workspacePath,
      note: "考点归类",
      entries: [
        {
          id: "sample-limit",
          before: ["极限", "等价无穷小"],
          after: ["极限", "函数极限"]
        }
      ]
    });
  });

  it("writes question types without touching topics", async () => {
    const app = await setup();
    const before = await getBank(app);
    const response = await postTags(app, {
      schemaVersion: 1,
      field: "questionTypes",
      renames: [{ from: "填空", to: "选择" }]
    });
    expect(response.status).toBe(200);
    expect(response.body.field).toBe("questionTypes");
    expect(response.body.journal.field).toBe("questionTypes");
    const { bank } = await getBank(app);
    expect(bank.items.map((item) => item.questionTypes)).toEqual([["解答"], ["选择"]]);
    expect(bank.items.map((item) => item.topics)).toEqual(
      before.bank.items.map((item) => item.topics)
    );
  });

  it("snapshots a v3 bank before the first write upgrades it to v4", async () => {
    const app = await setup();
    const current = await getBank(app);
    const v3 = {
      ...current.bank,
      version: 3,
      items: current.bank.items.map(({ topics: _topics, questionTypes: _types, ...item }) => ({
        ...item,
        tags: ["考点·极限", "题型·解答", "考法·泰勒"]
      }))
    };
    const raw = `${JSON.stringify(v3, null, 2)}\n`;
    await writeFile(path.join(workspacePath, "bank.json"), raw, "utf8");
    const historyBefore = await historyFiles();

    const response = await postTags(app, addTag("sample-limit", "新考点"));
    expect(response.status).toBe(200);
    const stored = JSON.parse(
      await readFile(path.join(workspacePath, "bank.json"), "utf8")
    ) as Bank;
    expect(stored.version).toBe(4);
    expect(stored.items[0]).toMatchObject({
      topics: ["极限", "新考点"],
      questionTypes: ["解答"]
    });
    const added = (await historyFiles()).filter((file) => !historyBefore.includes(file));
    expect(added).toHaveLength(1);
    expect(await readFile(path.join(workspacePath, ".history", added[0]), "utf8")).toBe(raw);

    // 已经是 v4 后，后续整理照常不拍快照。
    await postTags(app, addTag("sample-limit", "再加"));
    expect(await historyFiles()).toHaveLength(historyBefore.length + 1);
  });

  it("leaves the bank and revision alone when nothing would change", async () => {
    const app = await setup();
    const before = await getBank(app);
    const response = await postTags(app, addTag("sample-limit", "极限"));
    expect(response.status).toBe(200);
    expect(response.body.counts).toMatchObject({ changed: 0, unchanged: 1 });
    expect(response.body.journal).toBeUndefined();
    expect(response.body.revision).toBe(before.revision);
    expect((await getBank(app)).revision).toBe(before.revision);
  });

  it("renames and deletes topics across the whole bank", async () => {
    const app = await setup();
    const renamed = await postTags(app, {
      schemaVersion: 1,
      field: "topics",
      renames: [{ from: "极限", to: "函数极限" }],
      deletions: ["矩阵", "不存在"]
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body.counts).toMatchObject({ changed: 2, added: 1, removed: 2 });
    expect(renamed.body.warnings).toEqual([
      { code: "TAG_NOT_FOUND", message: "没有题目使用考点「不存在」。" }
    ]);
    const { bank } = await getBank(app);
    expect(bank.items.map((item) => item.topics)).toEqual([
      ["函数极限", "等价无穷小"],
      ["行列式"]
    ]);
  });

  it("rejects invalid input and unknown questions without writing", async () => {
    const app = await setup();
    const before = await getBank(app);

    const missing = await postTags(app, addTag("missing", "x"));
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe("AGENT_TAGS_INVALID");
    expect(missing.body.error).toContain("missing");

    for (const manifest of [
      { schemaVersion: 2, changes: [] },
      { schemaVersion: 1, changes: [{ id: "sample-limit", add: ["a"] }] },
      { schemaVersion: 1, field: "tags", changes: [{ id: "sample-limit", add: ["a"] }] },
      { schemaVersion: 1, field: "topics", changes: [{ id: "sample-limit", add: ["待审阅"] }] },
      {
        schemaVersion: 1,
        field: "topics",
        changes: [{ id: "sample-limit", add: ["a"] }],
        deletions: ["b"]
      }
    ]) {
      const response = await postTags(app, manifest as AgentTagManifest);
      expect(response.status).toBe(400);
      expect(response.body.code).toBe("AGENT_TAGS_INVALID");
    }
    expect(await getBank(app)).toEqual(before);
  });

  it("rejects a non-boolean dryRun instead of treating it as a real write", async () => {
    const app = await setup();
    const before = await getBank(app);
    for (const dryRun of ["true", 1, null]) {
      const response = await request(app)
        .post("/api/agent/tags")
        .set("Authorization", `Bearer ${getAgentToken()}`)
        .send({
          workspacePath,
          manifest: addTag("sample-limit", "x"),
          dryRun
        });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe("AGENT_TAGS_INVALID");
      expect(response.body.error).toContain("dryRun");
    }
    const undo = await request(app)
      .post("/api/agent/tags/undo")
      .set("Authorization", `Bearer ${getAgentToken()}`)
      .send({
        workspacePath,
        journal: {
          schemaVersion: 1,
          field: "topics",
          workspacePath,
          createdAt: "2026-10-27T00:00:00.000Z",
          note: null,
          entries: [{ id: "sample-limit", before: ["极限"], after: ["x"] }]
        },
        dryRun: "yes"
      });
    expect(undo.status).toBe(400);
    expect(undo.body.error).toContain("dryRun");
    expect(await getBank(app)).toEqual(before);
  });

  it("reports BANK_CONFLICT when the bank changed after the agent read it", async () => {
    const app = await setup();
    const before = await getBank(app);
    await request(app)
      .put("/api/bank")
      .send({
        workspacePath,
        baseRevision: before.revision,
        bank: touchSource(before.bank)
      })
      .expect(200);

    const response = await postTags(app, addTag("sample-limit", "x"), {
      baseRevision: before.revision
    });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("BANK_CONFLICT");
    const after = await getBank(app);
    expect(
      after.bank.items.find((item) => item.id === "sample-limit")?.topics
    ).toEqual(["极限", "等价无穷小"]);
  });

  it("refuses to write to a workspace that is not the current one", async () => {
    const app = await setup();
    const response = await postTags(app, addTag("sample-limit", "x"), {
      workspace: path.resolve(".tmp/vitest-agent-tags-other")
    });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("WORKSPACE_CHANGED");
  });

  it("serializes concurrent writes so no topic is lost", async () => {
    const app = await setup();
    const responses = await Promise.all(
      ["甲", "乙", "丙"].map((tag) =>
        postTags(app, addTag("sample-limit", tag), { baseRevision: null })
      )
    );
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
    const { bank } = await getBank(app);
    expect(
      bank.items.find((item) => item.id === "sample-limit")?.topics.sort()
    ).toEqual(["极限", "等价无穷小", "丙", "乙", "甲"].sort());
  });

  it("undoes a change from its journal and tolerates repeating the undo", async () => {
    const app = await setup();
    const original = await getBank(app);
    const applied = await postTags(app, {
      schemaVersion: 1,
      field: "topics",
      changes: [
        { id: "sample-limit", add: ["函数极限"], remove: ["等价无穷小"] },
        { id: "sample-linear-algebra", add: ["矩阵运算"] }
      ]
    });
    const journal = applied.body.journal as AgentTagJournal;

    const preview = await postUndo(app, journal, { dryRun: true });
    expect(preview.status).toBe(200);
    expect(preview.body.counts).toEqual({ restored: 2, unchanged: 0, conflicts: 0 });
    expect(preview.body.dryRun).toBe(true);

    const undone = await postUndo(app, journal);
    expect(undone.status).toBe(200);
    expect(undone.body.counts).toEqual({ restored: 2, unchanged: 0, conflicts: 0 });
    const restored = await getBank(app);
    expect(undone.body.revision).toBe(restored.revision);
    expect(restored.bank.items.map((item) => item.topics)).toEqual(
      original.bank.items.map((item) => item.topics)
    );
    expect(restored.bank.items.map((item) => item.reviewStatus)).toEqual(
      original.bank.items.map((item) => item.reviewStatus)
    );

    const again = await postUndo(app, journal);
    expect(again.status).toBe(200);
    expect(again.body.counts).toEqual({ restored: 0, unchanged: 2, conflicts: 0 });
    expect((await getBank(app)).revision).toBe(restored.revision);
  });

  it("does not undo over topics the user changed afterwards", async () => {
    const app = await setup();
    const applied = await postTags(app, {
      schemaVersion: 1,
      field: "topics",
      changes: [
        { id: "sample-limit", add: ["函数极限"] },
        { id: "sample-linear-algebra", add: ["矩阵运算"] }
      ]
    });
    const journal = applied.body.journal as AgentTagJournal;
    const current = await getBank(app);
    await request(app)
      .put("/api/bank")
      .send({
        workspacePath,
        baseRevision: current.revision,
        bank: {
          ...current.bank,
          items: current.bank.items.map((item) =>
            item.id === "sample-limit"
              ? { ...item, topics: [...item.topics, "用户后加"] }
              : item
          )
        }
      })
      .expect(200);

    const undone = await postUndo(app, journal);
    expect(undone.status).toBe(200);
    expect(undone.body.counts).toEqual({ restored: 1, unchanged: 0, conflicts: 1 });
    expect(undone.body.conflicts).toEqual([
      { id: "sample-limit", source: "示例题库 示例 1", reason: "changed" }
    ]);
    const { bank } = await getBank(app);
    expect(bank.items.map((item) => item.topics)).toEqual([
      ["极限", "等价无穷小", "函数极限", "用户后加"],
      ["矩阵", "行列式"]
    ]);
  });

  it("rejects a journal from another workspace or with the wrong shape", async () => {
    const app = await setup();
    const applied = await postTags(app, addTag("sample-limit", "x"));
    const journal = applied.body.journal as AgentTagJournal;

    const foreign = await postUndo(app, {
      ...journal,
      workspacePath: path.resolve(".tmp/vitest-agent-tags-other")
    });
    expect(foreign.status).toBe(409);
    expect(foreign.body.code).toBe("WORKSPACE_CHANGED");

    const malformed = await postUndo(app, { ...journal, entries: [] });
    expect(malformed.status).toBe(400);
    expect(malformed.body.code).toBe("AGENT_TAGS_INVALID");

    const stale = await postUndo(app, journal, {
      baseRevision: "0".repeat(64)
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("BANK_CONFLICT");
  });

  it("broadcasts topic changes to connected renderers", async () => {
    const app = await setup();
    const abort = new AbortController();
    const stream = await fetch(`${app}/api/events`, { signal: abort.signal });
    const reader = stream.body!.getReader();
    const decoder = new TextDecoder();
    let received = "";
    const readUntil = async (pattern: RegExp) => {
      while (!pattern.test(received)) {
        const { value, done } = await reader.read();
        if (done) break;
        received += decoder.decode(value, { stream: true });
      }
    };
    try {
      await readUntil(/: connected/);
      const response = await postTags(app, addTag("sample-limit", "函数极限"));
      await readUntil(/event: bank-changed\ndata: .*\n\n/);
      const match = /event: bank-changed\ndata: (.*)\n\n/.exec(received);
      expect(match).not.toBeNull();
      expect(JSON.parse(match![1])).toEqual({
        workspacePath,
        revision: response.body.revision,
        source: "agent-tags",
        field: "topics",
        tagCounts: { changed: 1, unchanged: 0, added: 1, removed: 0 }
      });
    } finally {
      await reader.cancel().catch(() => undefined);
      abort.abort();
    }
  });
});

async function setup(): Promise<string> {
  const app = await listenLocal(createApiApp());
  await request(app)
    .post("/api/workspaces/create-sample")
    .send({ workspacePath })
    .expect(200);
  getAgentToken();
  return app;
}

async function getBank(app: string): Promise<{
  workspacePath: string;
  revision: string;
  bank: Bank;
}> {
  const response = await request(app).get("/api/bank").expect(200);
  return response.body as { workspacePath: string; revision: string; bank: Bank };
}

async function historyFiles(): Promise<string[]> {
  return readdir(path.join(workspacePath, ".history")).catch(() => []);
}

function addTag(id: string, tag: string): AgentTagManifest {
  return { schemaVersion: 1, field: "topics", changes: [{ id, add: [tag] }] };
}

// 用户在应用里改了别的东西，bank 的 revision 随之变化。
function touchSource(bank: Bank): Bank {
  return {
    ...bank,
    items: bank.items.map((item) =>
      item.id === "sample-linear-algebra"
        ? { ...item, modules: { ...item.modules, note: { tex: "用户改过。" } } }
        : item
    )
  };
}

async function postTags(
  app: string,
  manifest: AgentTagManifest,
  options: {
    dryRun?: boolean;
    workspace?: string;
    baseRevision?: string | null;
  } = {}
) {
  const baseRevision =
    options.baseRevision === undefined
      ? (await getBank(app)).revision
      : options.baseRevision;
  return request(app)
    .post("/api/agent/tags")
    .set("Authorization", `Bearer ${getAgentToken()}`)
    .send({
      workspacePath: options.workspace ?? workspacePath,
      manifest,
      dryRun: options.dryRun === true,
      ...(baseRevision ? { baseRevision } : {})
    });
}

async function postUndo(
  app: string,
  journal: AgentTagJournal,
  options: { dryRun?: boolean; baseRevision?: string } = {}
) {
  const baseRevision = options.baseRevision ?? (await getBank(app)).revision;
  return request(app)
    .post("/api/agent/tags/undo")
    .set("Authorization", `Bearer ${getAgentToken()}`)
    .send({
      workspacePath,
      journal,
      dryRun: options.dryRun === true,
      baseRevision
    });
}
