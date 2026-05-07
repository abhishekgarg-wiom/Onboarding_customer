/**
 * Wiom AI booking-assistant — ephemeral-token broker for OpenAI Realtime API.
 *
 * The browser cannot hold the OpenAI API key. This Worker mints a short-lived
 * client_secret that the browser uses ONLY for one WebRTC SDP handshake with
 * api.openai.com/v1/realtime. The secret expires in ~60s and grants access to
 * one session — safe to ship to the browser.
 *
 * Secrets (set via `wrangler secret put`):
 *   OPENAI_API_KEY     — sk-... (required)
 *   ALLOWED_ORIGINS    — comma-separated list of origins allowed to call this
 *                        worker. Defaults to "*". Tighten for production.
 */

const MODEL = "gpt-4o-realtime-preview-2024-12-17";
const VOICE = "shimmer"; // warm female; Indian-English/Hinglish friendly

const TOOLS = [
  {
    type: "function",
    name: "set_at_home",
    description:
      "Record whether the customer confirms they are physically at the home address right now. Call this as soon as you know.",
    parameters: {
      type: "object",
      properties: { at_home: { type: "boolean", description: "True if customer says yes / haan / ji / ghar par hi hu. False if they say no / nahi / bahar / office." } },
      required: ["at_home"],
    },
  },
  {
    type: "function",
    name: "set_landmark",
    description:
      "Record the nearby identifiable landmark the customer mentions (mandir, school, hospital, bank, petrol pump, mall, etc.). Use the customer's own words — preserve Hindi if they spoke Hindi.",
    parameters: {
      type: "object",
      properties: { landmark: { type: "string" } },
      required: ["landmark"],
    },
  },
  {
    type: "function",
    name: "set_floor",
    description:
      "Record the floor of the customer's unit. Normalize to: 'Ground floor', '1st floor', '2nd floor', '3rd floor', '4th floor', '5th floor', or 'NN floor' for higher floors.",
    parameters: {
      type: "object",
      properties: { floor: { type: "string" } },
      required: ["floor"],
    },
  },
  {
    type: "function",
    name: "set_building_color",
    description:
      "Record the building or main gate color. Format as 'हिंदी (English)' when possible — e.g., 'नीला (Blue)', 'पीला (Yellow)', 'सफ़ेद (White)'.",
    parameters: {
      type: "object",
      properties: { color: { type: "string" } },
      required: ["color"],
    },
  },
  {
    type: "function",
    name: "set_direction",
    description:
      "Record a short direction-from-landmark-to-home description in the customer's own words. Should be 5-30 words, mention turns, lane name, distinguishing markers.",
    parameters: {
      type: "object",
      properties: { direction: { type: "string" } },
      required: ["direction"],
    },
  },
  {
    type: "function",
    name: "complete_call",
    description:
      "Call this exactly once when verification is finished — either after the customer confirms the summary, or when the customer says they are not at home and the call must end. Pass a one-line Hinglish summary.",
    parameters: {
      type: "object",
      properties: { summary: { type: "string" } },
      required: ["summary"],
    },
  },
];

function buildInstructions({ variant, address, landmark }) {
  const variantBlock =
    variant === "D1"
      ? `Variant: D1. The customer has ALREADY selected a nearby landmark in the form: "${landmark || "—"}". DO NOT ask for landmark again. Briefly acknowledge it ("${landmark || "yeh landmark"} ke paas, sahi?") and move on.`
      : `Variant: D2. The customer has NOT yet shared a landmark. You MUST ask for one — call set_landmark when you capture it.`;

  return `You are "Wiom की booking assistant" — a warm, polite Indian woman doing a quick verification call before a Wiom technician visits the customer's home for broadband installation.

# About Wiom
Wiom is an unlimited home internet (broadband / WiFi) ISP for India. No daily data limits, no FUP throttling, fast install in 24-48 hours, low monthly price. You're calling because the customer just booked a Wiom plan.

# Your goal — exactly 4 to 5 small details
Collect these in order so the technician can find their home:
1. Are they currently at home? → set_at_home(true|false)
2. (D2 only) Nearest landmark → set_landmark(text)
3. Floor of their unit → set_floor(text)
4. Building / gate color → set_building_color(text)
5. Short direction from landmark to home → set_direction(text)

After all are captured: read back a one-line summary in Hinglish and ask "kya yeh sahi hai?". If yes → call complete_call. If no → ask what to fix, update, summarise again.

If at step 1 they say NO (not at home): warmly tell them this step needs to be done from inside the home so the technician details are accurate, and they can re-try once they reach home. Then call complete_call with a summary like "Customer not at home, will retry later".

# How to talk
- Speak natural Hinglish like a real Indian woman — Hindi-Devanagari first, English mixed in. Examples: "Ji, batayein", "Wiom ki team", "thoda detail mein", "samjha nahi, ek baar phir bolenge?".
- WARM, patient, concise. Customers may be elderly, first-time internet users, or speaking in a regional accent.
- ONE question at a time. Wait for the answer. Briefly confirm what you heard before moving on ("theek hai, ${"" /* placeholder */}2nd floor noted").
- If you don't understand, gently rephrase — DO NOT repeat the same sentence verbatim.
- Customer may answer in Hindi, English, Hinglish, or with regional accent (Punjabi, Bihari, Marathi, South Indian English, etc.) — accept all.
- If they go off-topic, politely steer back: "ji, bas yeh chote sawaal complete kar lein, phir hum aapke ghar pahunch jaayenge."
- Never sound robotic. Never list multiple questions in one turn. Never read out tool-call JSON.
- Tool calls are SILENT — call them in the background as data arrives. Don't say "let me record that".

# Capture rules
- For floor: normalize to "Ground floor" / "1st floor" / "2nd floor" / "3rd floor" / "4th floor" / "5th floor" / "Nth floor".
- For color: prefer "हिंदी (English)" e.g. "नीला (Blue)", "सफ़ेद (White)".
- For landmark and direction: keep the customer's own phrasing — those exact words help the technician.
- If customer hesitates ≥3 times on the same field, accept their best attempt and move on. Don't trap them.

# Customer context (already on file)
- Address: ${address || "(captured in app form)"}
- ${variantBlock}

# Opening turn
Open the call yourself, immediately, without waiting for them. Say something like:
"Namaste! Main Wiom की booking assistant बात कर रही हूँ। Aapne abhi Wiom का unlimited internet book kiya hai — installation se pehle bas 4–5 chhote sawaal hain, jisse humara technician aapke ghar आसानी से pahunch sake. Theek hai? ... Pehle ye batayein — kya aap abhi ghar par hi hain?"

Speak warmly and at a relaxed pace.`;
}

function corsHeaders(origin, allowed) {
  const allowAll = !allowed || allowed === "*";
  const allowList = allowAll ? null : allowed.split(",").map((s) => s.trim());
  const allowedOrigin =
    allowAll ? "*" : (origin && allowList.includes(origin)) ? origin : allowList[0] || "*";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env.ALLOWED_ORIGINS);

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, model: MODEL }), {
        headers: { "Content-Type": "application/json", ...cors },
      });
    }

    if (req.method !== "POST" || url.pathname !== "/token") {
      return new Response("Not found", { status: 404, headers: cors });
    }

    if (!env.OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY not configured on worker" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...cors },
      });
    }

    let body = {};
    try { body = await req.json(); } catch (_) {}
    const variant = body.variant === "D1" ? "D1" : "D2";
    const address = typeof body.address === "string" ? body.address.slice(0, 240) : "";
    const landmark = typeof body.landmark === "string" ? body.landmark.slice(0, 120) : "";

    const instructions = buildInstructions({ variant, address, landmark });

    const r = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        voice: VOICE,
        instructions,
        modalities: ["audio", "text"],
        input_audio_transcription: { model: "whisper-1" },
        turn_detection: {
          type: "server_vad",
          threshold: 0.55,
          prefix_padding_ms: 300,
          silence_duration_ms: 700,
        },
        temperature: 0.7,
        tools: TOOLS,
        tool_choice: "auto",
      }),
    });

    const text = await r.text();
    return new Response(text, {
      status: r.status,
      headers: { "Content-Type": "application/json", ...cors },
    });
  },
};
