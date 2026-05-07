/**
 * Wiom AI booking-assistant — ephemeral-token broker for OpenAI Realtime API.
 *
 * The browser cannot hold the OpenAI API key. This Worker mints a short-lived
 * client_secret that the browser uses ONLY for one WebRTC SDP handshake with
 * api.openai.com/v1/realtime. The secret expires in ~60s and grants access to
 * one session — safe to ship to the browser.
 *
 * Voice agent prompt + tool spec are sourced verbatim from the reference
 * Wiom prototype:
 *   https://github.com/ryangerardwilson/wiom-customer-location-prototype
 *   (backend/lib/address-agent.js — buildAddressAgentInstructions, submitAddressPacketTool)
 *
 * Secrets (set via `wrangler secret put`):
 *   OPENAI_API_KEY     — sk-... (required)
 *   ALLOWED_ORIGINS    — comma-separated list of origins allowed to call this
 *                        worker. Defaults to "*". Tighten for production.
 */

const MODEL = "gpt-realtime"; // Hinglish-friendly OpenAI Realtime
const VOICE = "alloy";        // matches the reference prototype

/* Tool spec — verbatim from address-agent.js */
const submitAddressPacketTool = {
  type: "function",
  name: "submit_address_packet",
  description: "Submit the completed install-address verification packet.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      typed_address: {
        type: "string",
        description: "The full address originally provided by the app.",
      },
      confirmed_landmark: {
        type: "string",
        description:
          "The landmark already confirmed by the app, OR the landmark captured during this voice call when the app did not pre-confirm one.",
      },
      is_currently_at_home: {
        type: "boolean",
        description:
          "True only when the customer explicitly confirms they are currently at home.",
      },
      floor: {
        type: "string",
        enum: ["", "Ground floor", "1st floor", "2nd floor", "3rd floor+"],
      },
      building_color: {
        type: "string",
        description:
          "Building/house/front-side color or closest useful visual description.",
      },
      customer_direction: {
        type: "string",
        description:
          "Practical direction note from the customer to help find the home.",
      },
      missing_fields: {
        type: "array",
        items: { type: "string" },
        description: "Any unresolved fields at submission time.",
      },
      confidence: {
        type: "string",
        enum: ["low", "medium", "high"],
      },
    },
    required: [
      "typed_address",
      "confirmed_landmark",
      "is_currently_at_home",
      "floor",
      "building_color",
      "customer_direction",
      "missing_fields",
      "confidence",
    ],
  },
};

/* System prompt — adapted from buildAddressAgentInstructions() in
   address-agent.js, with two adaptations for v5:
   1. We don't have GPS / serviceable city — just the typed address.
   2. We support a D2 variant where the landmark was NOT pre-confirmed by
      the form, so the AI must capture it during the call. This adds one
      conditional rule; everything else is verbatim. */
function buildInstructions({ variant, typedAddress, confirmedLandmark }) {
  const ta = typedAddress || "not provided";
  const cl = confirmedLandmark || "not provided";
  const haveLandmark = !!confirmedLandmark;

  /* The agent only ever asks two things, in this order:
     - confirmed_landmark (skip if app already pre-confirmed one)
     - customer_direction (always)
     The opening line and "do not ask landmark" rule both depend on whether
     the form picker captured a landmark, so we vary them per variant. */
  const landmarkVariantBlock = haveLandmark
    ? `Variant note: confirmed_landmark is pre-confirmed by the app ("${confirmedLandmark}"). DO NOT ask for it. Skip directly to the direction question. The mandatory opening line is: "${confirmedLandmark} se aapke ghar tak ka rasta bataiye — kaunsi gali, kis taraf mudna hai, koi pehchan?"`
    : `Variant note: confirmed_landmark was NOT pre-confirmed by the app. Your FIRST job is to capture it. The mandatory opening line is: "Aapke ghar ke paas koi pehchan wali jagah — mandir, school, bank, ya petrol pump — kaunsi hai?" Once captured, set confirmed_landmark in the final tool call AND ask the direction question next: "[landmark] se aapke ghar tak ka rasta bataiye — kaunsi gali, kis taraf mudna hai, koi pehchan?"`;

  return `
You are Wiom's Hinglish home-verification voice agent.

Goal:
The app already has the customer's precise typed address, presence at home,
floor, and (sometimes) a confirmed landmark. Your call exists ONLY to capture
what the app could not capture cleanly via form: a practical landmark-based
direction the technician can follow. Specifically, you must collect:
1. confirmed_landmark — only if the app did not pre-confirm one
2. customer_direction — always

Known app context:
- Typed full address from app: ${ta}
- Confirmed landmark from app: ${cl}

${landmarkVariantBlock}

Required verification fields:
- customer_direction: a practical direction note from the landmark / road /
  turn to the home, in the customer's own words. Should mention a turn, gali
  name, door colour, or other distinguishing marker — anything that helps a
  technician get to the door.

Conversation rules:
- Speak in simple Hinglish.
- Speak loudly, slowly, and clearly, like a phone support agent.
- The mandatory opening line is given in the variant note above. Use it
  verbatim. Do not say any prefix before it ("Bilkul", "Theek hai", "Namaste",
  "Hello", "Haan", etc).
- NEVER ask "kya aap abhi ghar par hain" — presence is already confirmed by
  the booking flow. Always set is_currently_at_home=true in the final tool
  call.
- NEVER ask the floor or building color — both are unnecessary; the typed
  address plus a good direction note are enough. Always set floor="" and
  building_color="" in the final tool call.
- NEVER ask the customer to repeat the full address. Never replace, rewrite,
  or infer the typed full address from speech.
- If the customer is on the D1 path (landmark already pre-confirmed), DO NOT
  ask the customer to restate the landmark — just use it as the anchor for
  the direction question.
- If the customer gives a vague direction like "landmark ke paas hai" or
  "yahan paas hi hai", ask once for more specific turn / gali / door-facing
  detail.
- Ask one short follow-up at a time. Do not explain the process unless the
  customer asks.
- Match the customer's spoken language/register. If the customer speaks mostly
  Hindi, answer in Hindi/Hinglish. If English, answer in English. If they mix,
  mirror the mix.
- Speak numbers in the same language/register the customer is using. Examples:
  if the customer says "sector saintis", say "saintis"; if "sector thirty
  seven", say "thirty seven"; if "plot pandrah sau chauvan", say it back that
  way, not as English digits.
- Do not ask for fields already provided in this call.
- When the direction is captured, briefly read back ONLY the direction (and
  landmark, if you captured it during this call) for confirmation:
    Without app-provided landmark: "${"${cl_or_yours}"} ke paas, rasta — ${"${dir}"}. Sahi?"
    With app-provided landmark:    "Direction noted — ${"${dir}"}. Sahi?"
- Do not call the submit_address_packet tool until the customer confirms by
  voice with a clear yes / haan / sahi / confirm / ok.
- If the customer corrects the direction (or landmark) during confirmation,
  update it, read back again, ask once more.
- After confirmation, say one short closing line: "Theek hai, verification ho
  gaya." Then call the submit_address_packet tool with:
    is_currently_at_home=true, floor="", building_color="",
    confirmed_landmark=<the landmark — either the app's or the one you just
    captured>, customer_direction=<the direction you captured>.

Completion criteria:
- customer_direction is present, customer has explicitly confirmed it.
- confirmed_landmark is present (either from app or captured this call).
- is_currently_at_home is always true (do not ask).
- floor is always "" (do not ask).
- building_color is always "" (do not ask).

Do not claim serviceability is approved. Only say that details are ready for
serviceability check.
`.trim();
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
    const typedAddress = typeof body.address === "string" ? body.address.slice(0, 240) : "";
    const confirmedLandmark = typeof body.landmark === "string" ? body.landmark.slice(0, 120) : "";

    const instructions = buildInstructions({ variant, typedAddress, confirmedLandmark });

    /* Session config — values mirror address-agent.js buildRealtimeSessionConfig. */
    const sessionConfig = {
      model: MODEL,
      voice: VOICE,
      instructions,
      modalities: ["audio", "text"],
      input_audio_transcription: {
        model: "gpt-4o-mini-transcribe",
        language: "hi",
      },
      turn_detection: {
        type: "server_vad",
        threshold: 0.78,
        prefix_padding_ms: 450,
        silence_duration_ms: 850,
        interrupt_response: false,
        create_response: true,
      },
      tools: [submitAddressPacketTool],
      tool_choice: "auto",
    };

    const r = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(sessionConfig),
    });

    const text = await r.text();
    return new Response(text, {
      status: r.status,
      headers: { "Content-Type": "application/json", ...cors },
    });
  },
};
