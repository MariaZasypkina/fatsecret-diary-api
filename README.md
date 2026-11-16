# fatsecret-diary-api

A small TypeScript REST API that logs meals to my FatSecret food diary.
It runs as serverless functions on Vercel and signs FatSecret OAuth 1.0a
requests itself, so my food journal can search foods and record entries
through plain HTTP calls. FatSecret then syncs each entry to Apple
Health, so the day's calories and macros show up there without any
manual logging.

My deployment runs at https://fatsecret-diary-api-one.vercel.app

## How it works

I take a photo of what I eat, estimate the dish, and the journal finds
the matching food in FatSecret and records it through this API. The
service holds no state and no database: every call talks to the
FatSecret Platform API directly.

FatSecret's diary methods need OAuth 1.0a, so each request is signed
with HMAC-SHA1. The app holds four FatSecret values as environment
variables: the consumer key and secret from the developer app, plus the
user access token and secret from a one-time authorization. Calls to
this API need a bearer token, so only I can log meals.

Layout:

- `api/` one serverless function per route (Vercel file routing)
- `lib/fatsecret.ts` OAuth 1.0a signing and the FatSecret REST client
- `lib/auth.ts` bearer token checks, timing-safe, fails closed
- `lib/http.ts` small JSON response helpers

Zero runtime dependencies. TypeScript, Node 20 or newer. `npm install`
then `npm run typecheck` to check the code.

## Setup

1. Create a FatSecret account in the app, if you don't have one.
2. Register a developer app at https://platform.fatsecret.com and copy
   the Consumer Key and Consumer Secret from the REST API OAuth 1.0
   section. The free Basic tier is enough.
3. Deploy this repo on Vercel and set the environment variables below.
   Leave the access token ones empty for now.
4. Pick a long random string for `API_BEARER_TOKEN` and set it too.
5. Connect your FatSecret account. Open
   `https://fatsecret-diary-api-one.vercel.app/api/auth/start?key=<your bearer token>`
   in a browser. The page fetches a request token and shows a FatSecret
   approval link. Log in with your FatSecret account, approve the app,
   and FatSecret shows a PIN. Paste the PIN back into the page and it
   shows an access token and secret. Add them as environment variables
   and redeploy. The authorization is one-time: the access token lasts
   until revoked.
6. In the FatSecret app, turn on Apple Health sync (More, Settings,
   Health app) so entries flow into Apple Health.

## Environment variables

| Variable | What it is |
| -------- | ---------- |
| `FATSECRET_CONSUMER_KEY` | Consumer key from the FatSecret developer app |
| `FATSECRET_CONSUMER_SECRET` | Consumer secret from the FatSecret developer app |
| `FATSECRET_ACCESS_TOKEN` | User access token from the one-time authorization |
| `FATSECRET_ACCESS_TOKEN_SECRET` | User access token secret from the authorization |
| `API_BEARER_TOKEN` | Bearer token this API requires on every call |

See `.env.example` for the full list.

## Authentication

Every call except the health check needs the bearer token:

```text
Authorization: Bearer <your token>
```

A missing or wrong token gets HTTP 401. The browser pages under
`/api/auth/` take the same token as a `?key=` query parameter instead.

## API

All examples use my deployment. Set the token first:

```sh
export API=https://fatsecret-diary-api-one.vercel.app
export TOKEN=<your bearer token>
```

### Health check

No auth needed.

```sh
curl $API/api
```

```json
{"ok": true, "name": "fatsecret-diary-api", "version": "0.1.0"}
```

There is no home page: the bare domain answers 404 by design.

### Search foods

```sh
curl -X POST $API/api/foods/search \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "banana", "max_results": 10, "page_number": 0}'
```

`query` is required. `max_results` defaults to 10 and is capped at 50;
`page_number` defaults to 0. The response is
`{"total_results": 1984, "foods": [...]}`; each food has `food_id`,
`food_name`, `food_type`, `brand_name` and `description`.

### Food detail

```sh
curl $API/api/foods/5388 -H "Authorization: Bearer $TOKEN"
```

Returns the food with every serving: `serving_id`, `description`,
metric amount and unit, calories, protein, carbohydrate, fat, fiber,
sugar and sodium per serving.

### List diary entries

```sh
curl "$API/api/diary/entries?date=2026-11-16" -H "Authorization: Bearer $TOKEN"
```

Returns `{"date": "2026-11-16", "entries": [...]}`. Each entry has
`food_entry_id`, `food_id`, `food_entry_name`, `serving_id`,
`number_of_units`, `meal`, `date_int`, `calories`, `protein`,
`carbohydrate` and `fat`. `date` is optional; when it is missing the
API uses the current UTC day, so pass the date explicitly unless UTC
is what you want.

### Add a diary entry

```sh
curl -X POST $API/api/diary/entries \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"food_id": "5388", "food_entry_name": "Banana", "serving_id": "19134", "number_of_units": 1, "meal": "breakfast", "date": "2026-11-16"}'
```

`meal` is `breakfast`, `lunch`, `dinner` or `other`. A successful add
answers HTTP 201 with `{"food_entry_id": "..."}`. Keep the id: it is
the only handle for deleting the entry.

`number_of_units` means different things depending on the serving.
For a natural serving like "1 cup", "1 tbsp" or "1 chop", it is a
count: 0.5 for half a burger, 2 for two tablespoons. For a metric
serving like "100 g", it is the amount in grams: 15 g of mashed
potatoes is `number_of_units` 15, not 0.15. Passing 0.15 logs 0.15 g,
which reads back as 0 kcal.

### Delete a diary entry

```sh
curl -X DELETE $API/api/diary/entries/25400881410 -H "Authorization: Bearer $TOKEN"
```

Answers `{"deleted": true, "food_entry_id": "25400881410"}`.

### Errors

- 400: bad input, for example a missing field or a malformed date.
- 401: missing or invalid bearer token.
- 405: wrong method for the route.
- 502: the call reached FatSecret and FatSecret refused it; the message
  names the problem.

## Notes

- Entries have to reference a food from FatSecret's database, so the
  logged numbers are FatSecret's numbers for the closest match, not the
  estimate from the photo. The photo estimate lives in the journal; the
  diary gets the closest real food.
- Dates are `YYYY-MM-DD`. The API converts them to FatSecret's day
  count (days since 1970-01-01).
- `food.create`, adding a brand-new food to the database, is a
  Premier-only method and is not used here.
- FatSecret's JSON turns a single-element list into a bare object. The
  client normalizes that, so callers always get arrays.
- The free Basic tier allows 5,000 calls a day.
