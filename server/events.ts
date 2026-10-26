import type { IncomingMessage, ServerResponse } from "node:http";

export interface BankChangedEvent {
  workspacePath: string;
  revision: string;
  source: "agent-import";
  batchId: string;
  counts: {
    created: number;
    updated: number;
    skipped: number;
    conflicts: number;
    assets: number;
  };
}

const clients = new Set<ServerResponse>();
const heartbeatTimers = new Map<ServerResponse, NodeJS.Timeout>();

export function registerEventClient(
  request: IncomingMessage,
  response: ServerResponse
): void {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  response.write(": connected\n\n");
  clients.add(response);
  const heartbeat = setInterval(() => {
    if (!response.writableEnded) response.write(": ping\n\n");
  }, 25_000);
  heartbeatTimers.set(response, heartbeat);
  request.on("close", () => {
    const timer = heartbeatTimers.get(response);
    if (timer) clearInterval(timer);
    heartbeatTimers.delete(response);
    clients.delete(response);
    if (!response.writableEnded) response.end();
  });
}

export function broadcastBankChanged(event: BankChangedEvent): void {
  const payload = `event: bank-changed\ndata: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) {
    if (!client.writableEnded) client.write(payload);
  }
}

export function closeEventClients(): void {
  for (const [client, timer] of heartbeatTimers) {
    clearInterval(timer);
    if (!client.writableEnded) client.end();
  }
  heartbeatTimers.clear();
  clients.clear();
}
