import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sendJson } from "../lib/http.js";

export default function handler(_req: VercelRequest, res: VercelResponse): void {
  sendJson(res, 200, {
    ok: true,
    name: "fatsecret-diary-api",
    version: "0.1.0",
  });
}
