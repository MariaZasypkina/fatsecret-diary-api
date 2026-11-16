import { createHmac, randomBytes } from "node:crypto";

const REST_URL = "https://platform.fatsecret.com/rest/server.api";
const REQUEST_TOKEN_URL =
  "https://authentication.fatsecret.com/oauth/request_token";
const AUTHORIZE_URL =
  "https://authentication.fatsecret.com/oauth/authorize";
const ACCESS_TOKEN_URL =
  "https://authentication.fatsecret.com/oauth/access_token";

export interface FatSecretConfig {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

export function configFromEnv(env: NodeJS.ProcessEnv): FatSecretConfig {
  return {
    consumerKey: requiredEnv(env, "FATSECRET_CONSUMER_KEY"),
    consumerSecret: requiredEnv(env, "FATSECRET_CONSUMER_SECRET"),
    accessToken: requiredEnv(env, "FATSECRET_ACCESS_TOKEN"),
    accessTokenSecret: requiredEnv(env, "FATSECRET_ACCESS_TOKEN_SECRET"),
  };
}

/**
 * Percent-encoding per RFC 3986. encodeURIComponent leaves !'()* alone,
 * OAuth does not.
 */
export function oauthEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (ch) =>
    `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function toQuery(params: Record<string, string>): string {
  return Object.keys(params)
    .map((key) => `${oauthEncode(key)}=${oauthEncode(params[key])}`)
    .join("&");
}

interface SigningConfig {
  consumerKey: string;
  consumerSecret: string;
  token?: string;
  tokenSecret?: string;
}

export interface SignOverrides {
  nonce?: string;
  timestamp?: string;
}

/**
 * Sign a request with OAuth 1.0a (HMAC-SHA1). Returns all parameters,
 * including the OAuth ones and the signature, ready to send as a query
 * string. Nonce and timestamp can be pinned for tests.
 */
export function signRequest(
  method: string,
  url: string,
  params: Record<string, string>,
  config: SigningConfig,
  overrides: SignOverrides = {},
): Record<string, string> {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: config.consumerKey,
    oauth_nonce: overrides.nonce ?? randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp:
      overrides.timestamp ?? Math.floor(Date.now() / 1000).toString(),
    oauth_version: "1.0",
  };
  if (config.token) {
    oauthParams.oauth_token = config.token;
  }
  const allParams = { ...params, ...oauthParams };
  const encoded = Object.keys(allParams).map(
    (key) => [oauthEncode(key), oauthEncode(allParams[key])] as const,
  );
  encoded.sort((a, b) => {
    if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
    if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
    return 0;
  });
  const paramString = encoded.map(([k, v]) => `${k}=${v}`).join("&");
  const baseString = [
    method.toUpperCase(),
    oauthEncode(url),
    oauthEncode(paramString),
  ].join("&");
  const signingKey = `${oauthEncode(config.consumerSecret)}&${oauthEncode(
    config.tokenSecret ?? "",
  )}`;
  const signature = createHmac("sha1", signingKey)
    .update(baseString)
    .digest("base64");
  return { ...allParams, oauth_signature: signature };
}

/**
 * POST the signed OAuth parameters as a form-encoded body. FatSecret's
 * servers do not accept POSTs with the parameters in the query string and
 * an empty body: depending on the front end, such a request is rejected
 * with 411 Length Required or fails signature verification.
 */
async function postForm(
  url: string,
  signedParams: Record<string, string>,
): Promise<URLSearchParams> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: toQuery(signedParams),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `FatSecret request failed (${res.status}): ${text.slice(0, 200)}`,
    );
  }
  return new URLSearchParams(text);
}

/** Step 1 of the 3-legged flow: ask FatSecret for a request token. */
export async function fetchRequestToken(
  consumerKey: string,
  consumerSecret: string,
): Promise<{ token: string; tokenSecret: string }> {
  const signed = signRequest(
    "POST",
    REQUEST_TOKEN_URL,
    { oauth_callback: "oob" },
    { consumerKey, consumerSecret },
  );
  const params = await postForm(REQUEST_TOKEN_URL, signed);
  const token = params.get("oauth_token");
  const tokenSecret = params.get("oauth_token_secret");
  if (!token || !tokenSecret) {
    throw new Error("FatSecret did not return a request token");
  }
  return { token, tokenSecret };
}

/** The page where the user approves the app and gets a PIN. */
export function authorizeUrl(requestToken: string): string {
  return `${AUTHORIZE_URL}?oauth_token=${oauthEncode(requestToken)}`;
}

/**
 * Step 3 of the 3-legged flow: trade the request token and the PIN the
 * user copied from FatSecret for a long-lived access token.
 */
export async function fetchAccessToken(
  consumerKey: string,
  consumerSecret: string,
  requestToken: string,
  requestTokenSecret: string,
  verifier: string,
): Promise<{ token: string; tokenSecret: string }> {
  const signed = signRequest(
    "POST",
    ACCESS_TOKEN_URL,
    { oauth_verifier: verifier },
    {
      consumerKey,
      consumerSecret,
      token: requestToken,
      tokenSecret: requestTokenSecret,
    },
  );
  const params = await postForm(ACCESS_TOKEN_URL, signed);
  const token = params.get("oauth_token");
  const tokenSecret = params.get("oauth_token_secret");
  if (!token || !tokenSecret) {
    throw new Error("FatSecret did not return an access token");
  }
  return { token, tokenSecret };
}

/**
 * Call a FatSecret REST method. All parameters go in the query string,
 * signed with OAuth 1.0a. FatSecret answers API errors as a JSON error
 * object, sometimes with HTTP 200, so both are checked.
 */
export async function fatsecretRequest(
  method: "GET" | "POST",
  params: Record<string, string>,
  config: FatSecretConfig,
): Promise<Record<string, any>> {
  const signed = signRequest(
    method,
    REST_URL,
    { ...params, format: "json" },
    {
      consumerKey: config.consumerKey,
      consumerSecret: config.consumerSecret,
      token: config.accessToken,
      tokenSecret: config.accessTokenSecret,
    },
  );
  const res =
    method === "POST"
      ? await fetch(REST_URL, {
          method,
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: toQuery(signed),
        })
      : await fetch(`${REST_URL}?${toQuery(signed)}`, { method });
  const text = await res.text();
  let data: Record<string, any>;
  try {
    data = JSON.parse(text) as Record<string, any>;
  } catch {
    throw new Error(`FatSecret returned invalid JSON (HTTP ${res.status})`);
  }
  if (data && typeof data === "object" && "error" in data) {
    const error = data.error as { code?: unknown; message?: unknown };
    throw new Error(
      `FatSecret error ${String(error.code ?? "?")}: ${String(
        error.message ?? "unknown error",
      )}`,
    );
  }
  if (!res.ok) {
    throw new Error(
      `FatSecret request failed (HTTP ${res.status}): ${text.slice(0, 200)}`,
    );
  }
  return data;
}

/**
 * FatSecret's JSON turns a single-element list into a bare object.
 * Normalize both shapes to an array.
 */
export function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function num(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** FatSecret counts dates as days since 1970-01-01. */
export function dateToDays(date: string): number {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms)) {
    throw new Error(`Invalid date, expected YYYY-MM-DD: ${date}`);
  }
  return Math.floor(ms / 86400000);
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface FoodSummary {
  food_id: string;
  food_name: string;
  food_type?: string;
  brand_name?: string;
  description?: string;
}

export interface Serving {
  serving_id: string;
  description: string;
  metric_amount?: number;
  metric_unit?: string;
  calories?: number;
  protein?: number;
  carbohydrate?: number;
  fat?: number;
  fiber?: number;
  sugar?: number;
  sodium?: number;
}

export interface FoodDetail extends FoodSummary {
  servings: Serving[];
}

export interface DiaryEntry {
  food_entry_id: string;
  food_id?: string;
  food_entry_name?: string;
  serving_id?: string;
  number_of_units?: number;
  meal?: string;
  date_int?: number;
  calories?: number;
  protein?: number;
  carbohydrate?: number;
  fat?: number;
}

export async function searchFoods(
  query: string,
  maxResults: number,
  pageNumber: number,
  config: FatSecretConfig,
): Promise<{ total_results: number; foods: FoodSummary[] }> {
  const data = await fatsecretRequest(
    "GET",
    {
      method: "foods.search",
      search_expression: query,
      max_results: String(maxResults),
      page_number: String(pageNumber),
    },
    config,
  );
  const foods = (data.foods ?? {}) as Record<string, any>;
  return {
    total_results: num(foods.total_results) ?? 0,
    foods: asArray<Record<string, any>>(foods.food).map((f) => ({
      food_id: String(f.food_id),
      food_name: String(f.food_name ?? ""),
      food_type: f.food_type ? String(f.food_type) : undefined,
      brand_name: f.brand_name ? String(f.brand_name) : undefined,
      description: f.food_description ? String(f.food_description) : undefined,
    })),
  };
}

export async function getFood(
  foodId: string,
  config: FatSecretConfig,
): Promise<FoodDetail> {
  const data = await fatsecretRequest(
    "GET",
    { method: "food.get", food_id: foodId },
    config,
  );
  const food = (data.food ?? {}) as Record<string, any>;
  const servings = asArray<Record<string, any>>(
    (food.servings as Record<string, any> | undefined)?.serving,
  );
  return {
    food_id: String(food.food_id ?? foodId),
    food_name: String(food.food_name ?? ""),
    food_type: food.food_type ? String(food.food_type) : undefined,
    brand_name: food.brand_name ? String(food.brand_name) : undefined,
    description: food.food_description ? String(food.food_description) : undefined,
    servings: servings.map((s) => ({
      serving_id: String(s.serving_id),
      description: String(s.serving_description ?? ""),
      metric_amount: num(s.metric_serving_amount),
      metric_unit: s.metric_serving_unit
        ? String(s.metric_serving_unit)
        : undefined,
      calories: num(s.calories),
      protein: num(s.protein),
      carbohydrate: num(s.carbohydrate),
      fat: num(s.fat),
      fiber: num(s.fiber),
      sugar: num(s.sugar),
      sodium: num(s.sodium),
    })),
  };
}

export type Meal = "breakfast" | "lunch" | "dinner" | "other";

export function parseMeal(value: unknown): Meal {
  if (typeof value === "string") {
    const meal = value.toLowerCase();
    if (
      meal === "breakfast" ||
      meal === "lunch" ||
      meal === "dinner" ||
      meal === "other"
    ) {
      return meal;
    }
  }
  throw new Error(
    `Invalid meal, expected breakfast, lunch, dinner or other: ${String(value)}`,
  );
}

export interface CreateEntryInput {
  food_id: string;
  food_entry_name: string;
  serving_id: string;
  number_of_units: number;
  meal: Meal;
  date: string; // YYYY-MM-DD
}

export async function createEntry(
  input: CreateEntryInput,
  config: FatSecretConfig,
): Promise<{ food_entry_id: string }> {
  const data = await fatsecretRequest(
    "POST",
    {
      method: "food_entry.create",
      food_id: input.food_id,
      food_entry_name: input.food_entry_name,
      serving_id: input.serving_id,
      number_of_units: String(input.number_of_units),
      meal: input.meal,
      date: String(dateToDays(input.date)),
    },
    config,
  );
  const id = (data.food_entry_id as { value?: unknown } | undefined)?.value;
  if (id === undefined || id === null) {
    throw new Error("FatSecret did not return a food_entry_id");
  }
  return { food_entry_id: String(id) };
}

export async function listEntries(
  date: string,
  config: FatSecretConfig,
): Promise<{ date: string; entries: DiaryEntry[] }> {
  const data = await fatsecretRequest(
    "GET",
    {
      method: "food_entries.get",
      date: String(dateToDays(date)),
    },
    config,
  );
  const entries = asArray<Record<string, any>>(
    (data.food_entries as Record<string, any> | undefined)?.food_entry,
  );
  return {
    date,
    entries: entries.map((e) => ({
      food_entry_id: String(e.food_entry_id),
      food_id: e.food_id ? String(e.food_id) : undefined,
      food_entry_name: e.food_entry_name
        ? String(e.food_entry_name)
        : undefined,
      serving_id: e.serving_id ? String(e.serving_id) : undefined,
      number_of_units: num(e.number_of_units),
      meal: e.meal ? String(e.meal) : undefined,
      date_int: num(e.date_int),
      calories: num(e.calories),
      protein: num(e.protein),
      carbohydrate: num(e.carbohydrate),
      fat: num(e.fat),
    })),
  };
}

export async function deleteEntry(
  foodEntryId: string,
  config: FatSecretConfig,
): Promise<void> {
  await fatsecretRequest(
    "POST",
    {
      method: "food_entry.delete",
      food_entry_id: foodEntryId,
    },
    config,
  );
}
