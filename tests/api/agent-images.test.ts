import { mkdir, readdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";
import type { Bank } from "../../shared/types.js";
import { getAgentToken } from "../../server/agent-auth.js";
import { appDataDir } from "../../server/app-state.js";
import { createApiApp } from "../../server/index.js";
import { listenLocal, request } from "../fixtures/api-server.js";

const workspacePath = path.resolve(".tmp/vitest-agent-images-workspace");
const outsideDir = path.resolve(".tmp/vitest-agent-images-outside");
const LEGACY = (file: string) =>
  `\\begin{center}\n\\includegraphics[width=0.75\\linewidth]{assets/${file}}\n\\end{center}`;

beforeEach(async () => {
  await rm(appDataDir, { recursive: true, force: true });
  await rm(workspacePath, { recursive: true, force: true });
  await rm(outsideDir, { recursive: true, force: true });
});

describe("agent image normalize API", () => {
  it("requires the agent token", async () => {
    const app = await setup();
    await request(app)
      .post("/api/agent/images/normalize")
      .send({ workspacePath })
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe("AGENT_UNAUTHORIZED"));
  });

  it("previews without writing, then rewrites with a history snapshot", async () => {
    const app = await setup();
    await writePng("wide.png", 1800, 600);
    await writePng("small.png", 580, 600);
    await seedQuestion(app, `看图。\n${LEGACY("wide.png")}\n${LEGACY("small.png")}`);
    const before = await getBank(app);

    const preview = await postNormalize(app, { dryRun: true });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({
      dryRun: true,
      revision: before.revision,
      counts: { items: 1, images: 2, skipped: 0 }
    });
    expect((await getBank(app)).revision).toBe(before.revision);
    const historyBefore = await historyFiles();

    const written = await postNormalize(app);
    expect(written.status).toBe(200);
    expect(written.body.revision).not.toBe(before.revision);
    const after = await getBank(app);
    expect(after.bank.items[0]!.modules.question.tex).toBe(
      "看图。\n\\qimg[l]{assets/wide.png}\n\\qimg[s]{assets/small.png}"
    );
    expect(after.bank.items[0]!.reviewStatus).toBe(before.bank.items[0]!.reviewStatus);
    expect((await historyFiles()).length).toBe(historyBefore.length + 1);

    const again = await postNormalize(app);
    expect(again.body.counts).toEqual({ items: 0, images: 0, skipped: 0 });
    expect(again.body.revision).toBe(after.revision);
  });

  it("skips missing and symlinked images instead of following them", async () => {
    const app = await setup();
    await mkdir(outsideDir, { recursive: true });
    const outside = path.join(outsideDir, "outside.png");
    await writeFile(outside, await png(900, 700));
    await mkdir(path.join(workspacePath, "assets"), { recursive: true });
    await symlink(outside, path.join(workspacePath, "assets", "link.png"));
    await seedQuestion(app, `${LEGACY("link.png")}\n${LEGACY("gone.png")}`);
    const before = await getBank(app);

    const response = await postNormalize(app);
    expect(response.status).toBe(200);
    expect(response.body.counts).toEqual({ items: 0, images: 0, skipped: 2 });
    expect((await getBank(app)).revision).toBe(before.revision);
  });

  it("reports BANK_CONFLICT for a stale revision", async () => {
    const app = await setup();
    const response = await postNormalize(app, { baseRevision: "0".repeat(64) });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("BANK_CONFLICT");
  });

  it("broadcasts the rewrite to connected renderers", async () => {
    const app = await setup();
    await writePng("mid.png", 900, 700);
    await seedQuestion(app, LEGACY("mid.png"));
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
      const response = await postNormalize(app);
      await readUntil(/event: bank-changed\ndata: .*\n\n/);
      const match = /event: bank-changed\ndata: (.*)\n\n/.exec(received);
      expect(JSON.parse(match![1])).toEqual({
        workspacePath,
        revision: response.body.revision,
        source: "agent-images",
        imageCounts: { items: 1, images: 1, skipped: 0 }
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

async function png(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: "white" } }).png().toBuffer();
}

async function writePng(file: string, width: number, height: number): Promise<void> {
  await mkdir(path.join(workspacePath, "assets"), { recursive: true });
  await writeFile(path.join(workspacePath, "assets", file), await png(width, height));
}

async function getBank(app: string): Promise<{ revision: string; bank: Bank }> {
  const response = await request(app).get("/api/bank").expect(200);
  return response.body as { revision: string; bank: Bank };
}

// 通过正常保存接口写入旧写法，模拟旧版上传按钮留下的题目。
async function seedQuestion(app: string, tex: string): Promise<void> {
  const { revision, bank } = await getBank(app);
  const [first, ...rest] = bank.items;
  const next: Bank = {
    ...bank,
    items: [{ ...first!, modules: { ...first!.modules, question: { tex } } }, ...rest]
  };
  await request(app)
    .put("/api/bank")
    .send({ workspacePath, baseRevision: revision, bank: next })
    .expect(200);
}

async function historyFiles(): Promise<string[]> {
  return readdir(path.join(workspacePath, ".history")).catch(() => []);
}

async function postNormalize(
  app: string,
  options: { dryRun?: boolean; baseRevision?: string } = {}
) {
  const baseRevision = options.baseRevision ?? (await getBank(app)).revision;
  return request(app)
    .post("/api/agent/images/normalize")
    .set("Authorization", `Bearer ${getAgentToken()}`)
    .send({ workspacePath, baseRevision, dryRun: options.dryRun ?? false });
}

