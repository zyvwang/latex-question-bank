import { randomBytes, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { sendApiError } from "./http/api-response.js";

let activeToken = "";

export function getAgentToken(): string {
  if (!activeToken) activeToken = randomBytes(32).toString("hex");
  return activeToken;
}

export const requireAgentToken: RequestHandler = (request, response, next) => {
  const header = request.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match || !sameToken(match[1], getAgentToken())) {
    sendApiError(response, 401, "Agent 访问令牌无效。", "AGENT_UNAUTHORIZED");
    return;
  }
  next();
};

function sameToken(received: string, expected: string): boolean {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
