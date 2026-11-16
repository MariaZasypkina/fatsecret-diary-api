import { timingSafeEqual } from "node:crypto";
import type { VercelRequest } from "@vercel/node";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Compare a raw key against the configured bearer token. */
export function rawKeyValid(key: string): boolean {
  const expected = process.env.API_BEARER_TOKEN;
  if (!expected) return false;
  return safeEqual(key, expected);
}

/** Check the Authorization: Bearer header. Fails closed when no token is set. */
export function bearerTokenValid(req: VercelRequest): boolean {
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Bearer ")) return false;
  return rawKeyValid(header.slice("Bearer ".length));
}

/** Check the ?key= query parameter, used by the browser-based auth pages. */
export function queryKeyValid(req: VercelRequest): boolean {
  const key = req.query.key;
  return typeof key === "string" && rawKeyValid(key);
}
