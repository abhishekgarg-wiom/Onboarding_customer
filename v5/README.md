# Wiom Onboarding · v5 — Realtime AI booking assistant

Live mobile-frame prototype of a **real-time voice AI** that completes the
home-installation verification call for Wiom customers. The AI:

- Speaks **Hinglish** in a warm Indian voice (`shimmer`)
- **Knows Wiom** is unlimited home internet (no daily limit, no FUP, fast install)
- **Listens** to the customer over WebRTC — true low-latency duplex audio
- Captures **floor**, **building color**, **landmark**, **direction** as
  the conversation flows, via OpenAI function-calls
- Routes to the success screen automatically when the customer confirms

Two variants:

| Variant | Form steps        | What the AI asks                                  |
|---------|-------------------|---------------------------------------------------|
| **D1**  | Address + Landmark | floor → color → direction (acknowledges landmark)  |
| **D2**  | Address only       | landmark → floor → color → direction               |

## Architecture

```
┌────────────┐  POST /token   ┌──────────────────┐
│  v5 page   │ ─────────────▶ │ Cloudflare Worker│   (holds OPENAI_API_KEY)
│ (browser)  │  client_secret │   /worker        │
│            │ ◀───────────── └──────────────────┘
│            │
│            │  WebRTC + SDP   ┌──────────────────┐
│            │ ◀──────────────▶│ api.openai.com   │
└────────────┘                  │ /v1/realtime     │
                                └──────────────────┘
```

The OpenAI key never reaches the browser. The Worker mints a one-shot
`client_secret` (~60s TTL); the browser uses it for exactly one SDP
handshake.

## Deploying — first time

```bash
# 1) Deploy the Cloudflare Worker (mints ephemeral tokens)
cd v5/worker
npm i -g wrangler
wrangler login
wrangler secret put OPENAI_API_KEY   # paste your sk-... key
wrangler secret put ALLOWED_ORIGINS  # paste: https://abhishekgarg-wiom.github.io
wrangler deploy
# wrangler prints something like: https://wiom-realtime-token.<you>.workers.dev

# 2) Wire the URL into the page
#    Open v5/index.html, search for WIOM_TOKEN_URL_DEFAULT, paste the URL.
#    OR (no redeploy needed) — in the browser DevTools console, run:
#       localStorage.setItem('wiom_token_url', 'https://wiom-realtime-token.<you>.workers.dev/token')

# 3) Push to GitHub Pages — already wired up
git add v5/
git commit -m "v5: Realtime Wiom AI"
git push
```

After deploy, the prototype is live at `https://abhishekgarg-wiom.github.io/Onboarding_customer/v5/`.

## Browser support

- **Chrome / Edge / Safari 14+** (desktop and Android) — full voice, no setup.
- **Firefox** — WebRTC works, but if mic permission fails the page falls back
  to a typed-input box and the model still replies (text in, voice out).

## What's better than v4

| | v4 (browser-only) | v5 (Realtime) |
|---|---|---|
| Speech recognition | Browser SpeechRecognition (poor on Indian accents) | Whisper via OpenAI (excellent Hinglish) |
| Voice | Robotic OS voice | Warm `shimmer` AI voice |
| Understanding | Keyword/regex matching | Full LLM, knows Wiom context |
| Conversation | Rigid FSM | Natural — handles tangents, corrections, "kya?" |
| Languages | Hindi script only | Hindi, English, Hinglish, regional accents |

## File map

```
v5/
├── index.html             ← the prototype
├── worker/
│   ├── worker.js          ← Cloudflare Worker source
│   ├── wrangler.toml      ← deploy config
│   └── README.md          ← deploy steps
└── README.md              ← this file
```
