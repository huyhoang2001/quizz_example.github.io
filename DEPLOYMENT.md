# Gemini deployment notes

## Structured JSON

The Worker uses the Gemini `generateContent` REST fields
`responseMimeType: "application/json"` and `responseJsonSchema`. It does not
send the unsupported `responseFormat` field or perform a wasted retry.

## Location errors

Cloudflare WARP on the developer's computer does not change the outbound
network location of a deployed Cloudflare Worker.

`GEMINI_API_BASE_URL` defaults to the direct Gemini Developer API endpoint. If
Google rejects that outbound location, set it to the `/v1beta/models` base URL
of a trusted Gemini-compatible relay hosted in a supported region:

```toml
[vars]
GEMINI_API_BASE_URL = "https://your-relay.example.com/v1beta/models"
```

The relay must forward the request path, body, `Content-Type`, and
`x-goog-api-key` header to the Gemini API. Do not log the API key or request
body. Restrict relay access to this application and apply rate limits.

For a production setup without a relay, migrate the provider call to Vertex AI
and select a supported regional endpoint such as `asia-southeast1` or
`us-central1`. Vertex AI requires Google Cloud authentication and cannot use
the existing Gemini Developer API key unchanged.

Store `GEMINI_API_KEY` as a Worker secret, never in `wrangler.toml`:

```powershell
npx.cmd wrangler secret put GEMINI_API_KEY
```
