# Wiom Onboarding · v5 — Realtime AI booking assistant

Live mobile-frame prototype of a **real-time voice AI** that completes the
home-installation verification call for Wiom customers.

> 🔗 **Live demo:** https://abhishekgarg-wiom.github.io/Onboarding_customer/v5/

The AI:

- Speaks **Hinglish** in a warm Indian voice (`shimmer`)
- **Knows Wiom** — unlimited home internet, no daily limit, no FUP, fast install
- **Listens** over WebRTC — true low-latency duplex audio
- Captures **floor**, **building color**, **landmark**, **direction** through
  silent function calls as the conversation flows
- Routes to the success screen automatically on confirm

Two variants:

| Variant | Form steps         | What the AI asks on call                         |
|---------|--------------------|--------------------------------------------------|
| **D1**  | Address + Landmark | floor → color → direction (acks landmark)        |
| **D2**  | Address only       | landmark → floor → color → direction             |

## How to use the prototype

The prototype runs the OpenAI Realtime API — that's a paid service, so
**someone's** API key has to authorise the call. Two paths:

### Path A — Just paste a key (easiest, ~2 minutes) ✨ DEFAULT

1. Open the live demo URL above in **Chrome / Edge / Safari 14+**.
2. Walk through D1 or D2 until the AI screen opens — you'll see a setup card.
3. Get an OpenAI API key:
   - Go to https://platform.openai.com/api-keys
   - Sign in / create account
   - Add at least $5 of credit (one-time, on your OpenAI billing)
   - Click **"Create new secret key"** and copy it (`sk-proj-...`)
4. Paste the key into the setup card → **Save & start call**.

That's it. The key is saved in your browser's `localStorage` only — never
sent to Wiom servers. To revoke: hit "Clear stored key" on the setup card,
or just delete the OpenAI key from platform.openai.com.

A typical 60-90s call costs about **₹25** in OpenAI billing.

### Path B — Deploy a worker (no key prompt for visitors)

If you want to share the URL with team or stakeholders and they should NOT
have to paste a key, deploy the included Cloudflare Worker once. It holds
the OpenAI key as a secret and mints 60s ephemeral tokens for each call.

```bash
cd v5/worker
npm i -g wrangler
wrangler login
wrangler secret put OPENAI_API_KEY    # paste your sk-... key
wrangler secret put ALLOWED_ORIGINS   # paste: https://abhishekgarg-wiom.github.io
wrangler deploy
```

Wrangler prints a URL like `https://wiom-realtime-token.<you>.workers.dev`.
Open the demo, then in DevTools console:
```js
localStorage.setItem('wiom_token_url', 'https://wiom-realtime-token.<you>.workers.dev/token')
```
Reload — now the demo runs without prompting for a key. To make this the
default for everyone, edit `WIOM_TOKEN_URL_DEFAULT` near the top of the
script in `v5/index.html` and re-push.

## Architecture

```
              Path A — BYO-key (default)
   ┌────────────┐
   │  Browser   │ ────WebRTC SDP + Bearer (visitor's key)────▶  api.openai.com/v1/realtime
   └────────────┘                                                       │
                                                                        │ audio + tool calls
                                                                        ▼
                                                                   Browser plays audio
                                                                   updates captured-card

              Path B — Worker proxy (production-shareable)
   ┌────────────┐  POST /token  ┌──────────────────┐
   │  Browser   │ ─────────────▶│ Cloudflare Worker│  (holds OPENAI_API_KEY)
   │            │  client_secret└──────────────────┘
   │            │ ◀─────────────       (60s ephemeral)
   │            │
   │            │ ────WebRTC SDP + Bearer (ephemeral)─────────▶  api.openai.com/v1/realtime
   └────────────┘
```

In both paths the audio + tool calls flow over a single WebRTC
RTCPeerConnection with one data channel for events.

## Browser support

| Browser                          | Voice (mic + speaker) | Notes                                           |
|----------------------------------|-----------------------|-------------------------------------------------|
| Chrome / Edge desktop            | ✓ excellent           | First choice                                    |
| Chrome on Android                | ✓ excellent           | Use latest version                              |
| Safari 14+ macOS / iOS           | ✓ good                | iOS may take a beat to grant mic                |
| Firefox                          | ✓ works               | Falls back to typed-input if mic permission denied |

## What's better than v4

| | v4 (browser-only Web Speech) | v5 (OpenAI Realtime) |
|---|---|---|
| Speech recognition | Browser SpeechRecognition (poor on Indian accents) | Whisper-class model (excellent Hinglish, regional accents) |
| Voice | Robotic OS TTS | Warm `shimmer` AI voice |
| Understanding | Keyword + regex matching | Full LLM, knows Wiom context |
| Conversation | Rigid FSM | Natural — handles tangents, corrections, "kya?" |
| Languages | Hindi script only | Hindi + English + Hinglish + regional accents |

## File map

```
v5/
├── index.html             ← the prototype (zero-deploy default)
├── README.md              ← this file
└── worker/                ← optional production proxy
    ├── worker.js          ← Cloudflare Worker source
    ├── wrangler.toml      ← deploy config
    └── README.md          ← deploy steps
```

## Cost notes

OpenAI Realtime billing (Dec-2024 pricing):
- Audio input:  ~$0.06 / minute
- Audio output: ~$0.24 / minute
- Per call (60-90s): ~$0.25-0.40 (~₹20-35)

Cloudflare Workers free tier: 100k requests/day. The prototype will not
come close to this for the foreseeable future.
