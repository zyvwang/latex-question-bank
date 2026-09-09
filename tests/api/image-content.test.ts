import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import request from "supertest";
import { beforeEach, expect, it } from "vitest";
import { createApiApp } from "../../server/index.js";
import { appDataDir } from "../../server/app-state.js";
import { validPng } from "../fixtures/images.js";

const workspacePath = path.resolve(".tmp/vitest-image-content");
beforeEach(async () => {
  await rm(workspacePath, { recursive: true, force: true });
  await rm(appDataDir, { recursive: true, force: true });
});
async function setup() {
  const app = createApiApp();
  await request(app).post("/api/workspaces/create-empty").send({ workspacePath }).expect(200);
  return app;
}

it("accepts complete transparent PNG and baseline/progressive JPEG without rewriting bytes", async () => {
  const app = await setup();
  for (const [buffer, filename, contentType] of [
    [validPng, "transparent.png", "image/png"],
    [await sharp(validPng).jpeg().toBuffer(), "baseline.jpg", "image/jpeg"],
    [await sharp(validPng).jpeg({ progressive: true }).toBuffer(), "progressive.jpeg", "image/jpeg"]
  ] as const) {
    const response = await request(app).post("/api/assets").field("workspacePath", workspacePath)
      .attach("file", buffer, { filename, contentType }).expect(200);
    expect(await readFile(path.join(workspacePath, response.body.asset.relativePath))).toEqual(buffer);
  }
});

it("rejects header-only, truncated, and damaged pixel data without writing assets", async () => {
  const app = await setup();
  const jpeg = await sharp(validPng).jpeg().toBuffer();
  const corrupted = Buffer.from(validPng);
  const idat = corrupted.indexOf("IDAT");
  corrupted[idat + 4] ^= 0xff;
  for (const [buffer, filename, contentType] of [
    [validPng.subarray(0, 8), "header.png", "image/png"],
    [Buffer.from([0xff, 0xd8, 0xff]), "header.jpg", "image/jpeg"],
    [validPng.subarray(0, idat + 8), "truncated.png", "image/png"],
    [jpeg.subarray(0, jpeg.length - 20), "truncated.jpg", "image/jpeg"],
    [corrupted, "corrupted.png", "image/png"]
  ] as const) {
    await request(app).post("/api/assets").field("workspacePath", workspacePath)
      .attach("file", buffer, { filename, contentType }).expect(400)
      .expect(({ body }) => expect(body.code).toBe("IMAGE_CONTENT_INVALID"));
    expect(await readdir(path.join(workspacePath, "assets"))).toEqual([]);
  }
});

it("rejects over 25 million pixels and preserves the 15 MiB upload limit", async () => {
  const app = await setup();
  const huge = await sharp({ create: { width: 5001, height: 5000, channels: 3, background: "white" } }).png().toBuffer();
  await request(app).post("/api/assets").field("workspacePath", workspacePath)
    .attach("file", huge, { filename: "huge.png", contentType: "image/png" }).expect(400)
    .expect(({ body }) => expect(body.code).toBe("IMAGE_DIMENSIONS_EXCEEDED"));
  await request(app).post("/api/assets").field("workspacePath", workspacePath)
    .attach("file", Buffer.alloc(15 * 1024 * 1024 + 1), { filename: "huge.png", contentType: "image/png" }).expect(400)
    .expect(({ body }) => expect(body.code).toBe("UPLOAD_INVALID"));
  expect(await readdir(path.join(workspacePath, "assets"))).toEqual([]);
});
