# fatsecret-diary-api

A small API that logs meals to my FatSecret food diary. I take a photo of
what I eat, estimate the dish, and this service finds the matching food in
FatSecret and records it. FatSecret then syncs the entry to Apple Health,
so the day's calories and macros show up there without any manual logging.

It runs as serverless functions on Vercel. No database, no state: every
call talks to the FatSecret Platform API directly.

## How it works

FatSecret's diary methods need OAuth 1.0a, so each request is signed with
HMAC-SHA1. The app holds four FatSecret values as environment variables:
the consumer key and secret from the developer app, plus the user access
token and secret from a one-time authorization. Calls to this API need a
bearer token, so only I can log meals.

## Endpoints

| Method | Path | What it does |
| ------ | ---- | ------------ |
| GET | `/api` | Health check, no auth needed |
| POST | `/api/foods/search` | Search FatSecret foods by name |
| GET | `/api/foods/:id` | Food detail with servings |
| GET | `/api/diary/entries?date=YYYY-MM-DD` | Entries for a day, today by default |
| POST | `/api/diary/entries` | Create a diary entry |
| DELETE | `/api/diary/entries/:id` | Delete a diary entry |
| GET | `/api/auth/start?key=...` | Connect a FatSecret account, one-time setup |

Search takes `{ "query": "...", "max_results": 10, "page_number": 0 }`.
Creating an entry takes `{ "food_id", "food_entry_name", "serving_id",
"number_of_units", "meal", "date" }`, where `meal` is `breakfast`, `lunch`,
`dinner` or `other` and `date` is `YYYY-MM-DD`.

## Setup

1. Create a FatSecret account in the app, if you don't have one.
2. Register a developer app at https://platform.fatsecret.com and copy the
   Consumer Key and Consumer Secret from the REST API OAuth 1.0 section.
   The free Basic tier is enough.
3. Deploy this repo on Vercel and set the environment variables below.
   Leave the access token ones empty for now.
4. Pick a long random string for `API_BEARER_TOKEN` and set it too.
5. Open `https://<your-app>.vercel.app/api/auth/start?key=<your bearer token>`,
   approve the app on FatSecret, and paste the PIN back. The page shows an
   access token and secret. Add them as environment variables and redeploy.
6. In the FatSecret app, turn on Apple Health sync (More, Settings, Health
   app) so entries flow into Apple Health.

## Environment variables

| Variable | What it is |
| -------- | ---------- |
| `FATSECRET_CONSUMER_KEY` | Consumer key from the FatSecret developer app |
| `FATSECRET_CONSUMER_SECRET` | Consumer secret from the FatSecret developer app |
| `FATSECRET_ACCESS_TOKEN` | User access token from the one-time authorization |
| `FATSECRET_ACCESS_TOKEN_SECRET` | User access token secret from the authorization |
| `API_BEARER_TOKEN` | Bearer token this API requires on every call |

See `.env.example` for the full list.

## Notes

- Entries have to reference a food from FatSecret's database, so the logged
  numbers are FatSecret's numbers for the closest match, not the estimate
  from the photo. The photo estimate lives in the journal; the diary gets
  the closest real food.
- Dates are `YYYY-MM-DD`. The API converts them to FatSecret's day count
  (days since 1970-01-01).
- `food.create`, adding a brand-new food to the database, is a
  Premier-only method and is not used here.
- FatSecret's JSON turns a single-element list into a bare object. The
  client normalizes that, so callers always get arrays.
