# animator-motion-proxy (Slice 1)

Cloudflare Worker that holds every provider key server-side. The browser
calls this worker with `x-app-token`; the worker injects the real keys
upstream. The browser bundle never contains a provider secret.

## Routes

| Method | Route             | Forwards to                              |
| ------ | ----------------- | ---------------------------------------- |
| GET    | `/health`         | local `{ok, version}` (no token needed)  |
| POST   | `/ai/chat`        | `https://api.meta.ai/v1/chat/completions`|
| GET    | `/stock/images`   | `STOCK_API_URL` (key injected as Bearer) |
| GET    | `/audio/music`    | `AUDIO_API_URL` + `?key=` (Pixabay shape)|
| GET    | `/audio/sfx`      | same as music                            |

Error codes mirror `motion-core` (`provider_unauthorized`,
`provider_rate_limited`, `provider_transport`, `bad_request`, ...).
Model ids are allowlisted to `muse-spark-*`; `max_tokens` is capped at 8192;
message count/size are bounded to cap cost.

## Env / secrets

Vars (`wrangler.toml` `[vars]`): `ALLOWED_ORIGIN`, `RATE_LIMIT_PER_MIN`,
`STOCK_API_URL`, `AUDIO_API_URL`.

Secrets (never in repo — `wrangler secret put <NAME>`):
`APP_TOKEN`, `META_API_KEY`, `STOCK_API_KEY`, `AUDIO_API_KEY`.

## Local test

Zero dependencies, Web standards only:

```sh
cd worker && npm test   # node --test, 10 tests, no network
```

## Deploy (needs a Cloudflare account; run by the owner)

```sh
cd worker
npx wrangler login
npx wrangler secret put APP_TOKEN
npx wrangler secret put META_API_KEY
npx wrangler secret put STOCK_API_KEY
npx wrangler secret put AUDIO_API_KEY
npx wrangler deploy
```

## Security notes

- Every non-health route requires the exact `x-app-token`; CORS origin
  allowlist is enforced (exact match, no wildcards).
- Client-supplied `Authorization` headers are ignored; keys are injected
  server-side only. Bodies/keys are never logged.
- Rate limiting here is a best-effort per-isolate sliding window. Harden
  production with Cloudflare Rate Limiting rules in front of the worker.
- Stock search shape is generic until the stock API is supplied; audio
  normalization assumes the Pixabay `{hits:[{id,previewURL}]}` shape.
