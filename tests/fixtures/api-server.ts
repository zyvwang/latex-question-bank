import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Express } from "express";
import supertest from "supertest";
import { afterAll } from "vitest";

// 不要把 Express app 直接交给 supertest：它会 listen(0) 绑定通配地址，再固定连 127.0.0.1。
// macOS 允许通配地址复用其他进程已在 127.0.0.1 上占用的端口，此时请求会打到那个进程
// （例如本机正在运行的正式版应用），表现为随机的 403/404/409。显式绑定 127.0.0.1
// 时端口被占用会直接失败，0 端口也只会分到该地址上的空闲端口。
const servers = new Set<Server>();

afterAll(async () => {
  await Promise.all(
    [...servers].map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve()))
    )
  );
  servers.clear();
});

export async function listenLocal(app: Express): Promise<string> {
  const server = app.listen(0, "127.0.0.1");
  servers.add(server);
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

/** 只接受 listenLocal 返回的地址，传入 Express app 会在类型检查时报错。 */
export function request(baseUrl: string) {
  return supertest(baseUrl);
}
