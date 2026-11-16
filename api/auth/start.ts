import type { VercelRequest, VercelResponse } from "@vercel/node";
import { queryKeyValid } from "../../lib/auth.js";
import { authorizeUrl, fetchRequestToken } from "../../lib/fatsecret.js";

/**
 * Step 1 of connecting a FatSecret account. Fetches a request token and
 * shows a page with the FatSecret approval link and a place to paste the
 * PIN FatSecret displays. The request token secret travels back through
 * the browser in the same page: it is single-use and short-lived.
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).send("Method not allowed");
    return;
  }
  if (!queryKeyValid(req)) {
    res.status(403).send("Forbidden");
    return;
  }
  const consumerKey = process.env.FATSECRET_CONSUMER_KEY;
  const consumerSecret = process.env.FATSECRET_CONSUMER_SECRET;
  if (!consumerKey || !consumerSecret) {
    res
      .status(500)
      .send(
        "FATSECRET_CONSUMER_KEY and FATSECRET_CONSUMER_SECRET must be set first.",
      );
    return;
  }
  try {
    const { token, tokenSecret } = await fetchRequestToken(
      consumerKey,
      consumerSecret,
    );
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(startPage(authorizeUrl(token), token, tokenSecret));
  } catch (err) {
    res
      .status(502)
      .send(
        `Could not start authorization: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
      );
  }
}

function startPage(
  approvalUrl: string,
  requestToken: string,
  requestTokenSecret: string,
): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect your FatSecret account</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; color: #222; margin: 0; padding: 24px; }
  main { max-width: 560px; margin: 0 auto; }
  h1 { font-size: 22px; }
  li { margin-bottom: 12px; line-height: 1.5; }
  input[type="text"] { width: 100%; box-sizing: border-box; padding: 10px; font-size: 16px; margin: 8px 0; }
  button { padding: 10px 18px; font-size: 16px; cursor: pointer; }
  .result { display: none; margin-top: 24px; border-top: 1px solid #ccc; padding-top: 16px; }
  .result label { display: block; margin: 12px 0 4px; font-weight: 600; }
  .result input { font-family: monospace; font-size: 13px; }
  .error { color: #a00; margin-top: 12px; }
  code { background: #f2f2f2; padding: 2px 5px; border-radius: 4px; }
</style>
</head>
<body>
<main>
  <h1>Connect your FatSecret account</h1>
  <ol>
    <li><a href="${approvalUrl}" target="_blank" rel="noopener">Open the FatSecret approval page</a>, log in with your FatSecret account, and approve the app.</li>
    <li>FatSecret shows a PIN. Copy it, paste it below, and press Connect.</li>
  </ol>
  <form id="pin-form">
    <input type="text" id="pin" placeholder="PIN from FatSecret" autocomplete="off" required>
    <button type="submit">Connect</button>
  </form>
  <p class="error" id="error"></p>
  <div class="result" id="result">
    <p>Connected. Add these two values as environment variables in Vercel and redeploy:</p>
    <label for="access-token">FATSECRET_ACCESS_TOKEN</label>
    <input type="text" id="access-token" readonly>
    <label for="access-secret">FATSECRET_ACCESS_TOKEN_SECRET</label>
    <input type="text" id="access-secret" readonly>
    <p>Keep them private. They let this app read and write your food diary.</p>
  </div>
</main>
<script>
  const REQUEST_TOKEN = ${JSON.stringify(requestToken)};
  const REQUEST_TOKEN_SECRET = ${JSON.stringify(requestTokenSecret)};
  const KEY = new URLSearchParams(window.location.search).get("key") || "";
  document.getElementById("pin-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const errorEl = document.getElementById("error");
    errorEl.textContent = "";
    const pin = document.getElementById("pin").value.trim();
    if (!pin) return;
    try {
      const res = await fetch("/api/auth/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: KEY,
          oauth_token: REQUEST_TOKEN,
          oauth_token_secret: REQUEST_TOKEN_SECRET,
          verifier: pin,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || ("Request failed: " + res.status));
      document.getElementById("access-token").value = data.access_token;
      document.getElementById("access-secret").value = data.access_token_secret;
      document.getElementById("result").style.display = "block";
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });
</script>
</body>
</html>`;
}
