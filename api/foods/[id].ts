import type { VercelRequest, VercelResponse } from "@vercel/node";
import { bearerTokenValid } from "../../lib/auth.js";
import { configFromEnv, getFood } from "../../lib/fatsecret.js";
import { methodNotAllowed, sendError, sendJson } from "../../lib/http.js";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== "GET") {
    methodNotAllowed(res, ["GET"]);
    return;
  }
  if (!bearerTokenValid(req)) {
    sendError(res, 401, "Missing or invalid bearer token");
    return;
  }
  const id = req.query.id;
  if (typeof id !== "string" || id.length === 0) {
    sendError(res, 400, "Food id is required");
    return;
  }
  try {
    const food = await getFood(id, configFromEnv(process.env));
    sendJson(res, 200, food);
  } catch (err) {
    sendError(
      res,
      502,
      err instanceof Error ? err.message : "FatSecret request failed",
    );
  }
}
