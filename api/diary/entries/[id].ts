import type { VercelRequest, VercelResponse } from "@vercel/node";
import { bearerTokenValid } from "../../../lib/auth.js";
import { configFromEnv, deleteEntry } from "../../../lib/fatsecret.js";
import { methodNotAllowed, sendError, sendJson } from "../../../lib/http.js";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== "DELETE") {
    methodNotAllowed(res, ["DELETE"]);
    return;
  }
  if (!bearerTokenValid(req)) {
    sendError(res, 401, "Missing or invalid bearer token");
    return;
  }
  const id = req.query.id;
  if (typeof id !== "string" || id.length === 0) {
    sendError(res, 400, "Entry id is required");
    return;
  }
  try {
    await deleteEntry(id, configFromEnv(process.env));
    sendJson(res, 200, { deleted: true, food_entry_id: id });
  } catch (err) {
    sendError(
      res,
      502,
      err instanceof Error ? err.message : "FatSecret request failed",
    );
  }
}
