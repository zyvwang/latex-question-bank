import request from "supertest";
import express from "express";
import { expect, it } from "vitest";
import { createApiApp } from "../../server/index.js";

it.each(["untrusted.example", "127.0.0.1.evil.example", "127.1", "2130706433", "localhost:0", "localhost:65536", "user@localhost", "localhost/path"])(
  "rejects untrusted or malformed Host %s before routing",
  async (host) => {
    for (const url of ["/api/bank", "/assets/test.png", "/tmp/test.pdf"]) {
      const result = await request(createApiApp()).get(url).set("Host", host)
        .set("X-Forwarded-Host", "localhost").expect(403);
      expect(result.body.code).toBe("HOST_FORBIDDEN");
    }
  }
);

it.each(["localhost", "LOCALHOST:5174", "127.0.0.1:5174", "[::1]:5174"])(
  "accepts loopback Host %s without trusting forwarding headers",
  async (host) => {
    await request(createApiApp()).get("/api/unknown").set("Host", host)
      .set("X-Forwarded-Host", "untrusted.example").expect(404);
  }
);

it("rejects a missing Host and rejects writes before parsing their body", async () => {
  const missingHostApp = express();
  missingHostApp.use((request, _response, next) => { delete request.headers.host; next(); });
  missingHostApp.use(createApiApp());
  await request(missingHostApp).get("/api/bank").expect(403);
  const result = await request(createApiApp()).post("/api/compile-item")
    .set("Host", "untrusted.example").set("Content-Type", "application/json")
    .send("{invalid").expect(403);
  expect(result.body.code).toBe("HOST_FORBIDDEN");
});

it("preserves the mutating Origin check for IPv6 loopback", async () => {
  await request(createApiApp()).post("/api/compile-item").set("Host", "[::1]:5174")
    .set("Origin", "http://[::1]:5174").send({}).expect(400);
  await request(createApiApp()).post("/api/compile-item").set("Host", "[::1]:5174")
    .set("Origin", "https://untrusted.example").send({}).expect(403);
});
