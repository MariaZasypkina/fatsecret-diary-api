import type { VercelResponse } from "@vercel/node";

export function sendJson(
  res: VercelResponse,
  status: number,
  body: unknown,
): void {
  res.status(status).json(body);
}

export function sendError(
  res: VercelResponse,
  status: number,
  message: string,
): void {
  res.status(status).json({ error: message });
}

export function methodNotAllowed(
  res: VercelResponse,
  allowed: string[],
): void {
  res.setHeader("Allow", allowed.join(", "));
  sendError(res, 405, `Method not allowed, use ${allowed.join(" or ")}`);
}
