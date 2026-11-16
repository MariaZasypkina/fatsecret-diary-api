import type { VercelRequest, VercelResponse } from "@vercel/node";
import { bearerTokenValid } from "../../lib/auth.js";
import {
  configFromEnv,
  createEntry,
  listEntries,
  parseMeal,
  todayIso,
} from "../../lib/fatsecret.js";
import { methodNotAllowed, sendError, sendJson } from "../../lib/http.js";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function requiredString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} is required`);
  }
  return value;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== "GET" && req.method !== "POST") {
    methodNotAllowed(res, ["GET", "POST"]);
    return;
  }
  if (!bearerTokenValid(req)) {
    sendError(res, 401, "Missing or invalid bearer token");
    return;
  }
  try {
    const config = configFromEnv(process.env);
    if (req.method === "GET") {
      const dateParam = req.query.date;
      const date =
        typeof dateParam === "string" && dateParam.length > 0
          ? dateParam
          : todayIso();
      if (!DATE_PATTERN.test(date)) {
        sendError(res, 400, "date must be YYYY-MM-DD");
        return;
      }
      sendJson(res, 200, await listEntries(date, config));
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const numberOfUnits = body.number_of_units;
    if (
      typeof numberOfUnits !== "number" ||
      !Number.isFinite(numberOfUnits) ||
      numberOfUnits <= 0
    ) {
      sendError(res, 400, "number_of_units must be a number above zero");
      return;
    }
    const date =
      typeof body.date === "string" && body.date.length > 0
        ? body.date
        : todayIso();
    if (!DATE_PATTERN.test(date)) {
      sendError(res, 400, "date must be YYYY-MM-DD");
      return;
    }
    const result = await createEntry(
      {
        food_id: requiredString(body, "food_id"),
        food_entry_name: requiredString(body, "food_entry_name"),
        serving_id: requiredString(body, "serving_id"),
        number_of_units: numberOfUnits,
        meal: parseMeal(body.meal),
        date,
      },
      config,
    );
    sendJson(res, 201, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Request failed";
    const status =
      message.includes("is required") ||
      message.startsWith("Invalid meal") ||
      message.startsWith("Invalid date")
        ? 400
        : 502;
    sendError(res, status, message);
  }
}
