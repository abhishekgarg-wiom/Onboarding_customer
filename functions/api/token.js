/**
 * Cloudflare Pages Function — mints OpenAI Realtime ephemeral tokens.
 *
 * Deployed automatically when this repo is connected to Cloudflare Pages.
 * Endpoint becomes:  https://<your-pages>.pages.dev/api/token
 *
 * Required environment variable (set in Pages Settings → Environment variables):
 *   OPENAI_API_KEY — sk-... (Production scope)
 *
 * Optional:
 *   ALLOWED_ORIGINS — comma-separated origin allowlist; defaults to "*"
 *
 * The agent prompt + voice + VAD config + tool spec mirror the reference repo:
 *   https://github.com/ryangerardwilson/wiom-customer-location-prototype
 *   (backend/lib/address-agent.js — buildAddressAgentInstructions / submitAddressPacketTool)
 */

const MODEL = "gpt-realtime";
const VOICE = "alloy";

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
        description: "True only when the customer explicitly confirms they are currently at home.",
      },
      floor: {
        type: "string",
        enum: ["", "Ground floor", "1st floor", "2nd floor", "3rd floor+"],
      },
      building_color: {
        type: "string",
        description: "Building/house/front-side color or closest useful visual description.",
      },
      customer_direction: {
        type: "string",
        description: "Practical direction note from the customer to help find the home.",
      },
      missing_fields: {
        type: "array",
        items: { type: "string" },
        description: "Any unresolved fields at submission time.",
      },
      confidence: { type: "string", enum: ["low", "medium", "high"] },
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

function buildInstructions({ variant, typedAddress, confirmedLandmark }) {
  const ta = typedAddress || "not provided";
  const cl = confirmedLandmark || "not provided";

  const landmarkVariantBlock =
    variant === "D2" || !confirmedLandmark
      ? `Variant note: confirmed_landmark was NOT pre-confirmed by the app. Before asking for direction, ask the customer once for a nearby identifiable landmark (mandir, school, hospital, bank, petrol pump, mall etc.) and capture their words as confirmed_landmark in the final tool call.`
      : `Variant note: confirmed_landmark is pre-confirmed by the app — do not ask the customer to restate it.`;

  return `
You are Wiom's Hinglish home-verification voice agent.

Goal:
Verify the typed install-address packet without trying to recapture the full
address by voice. The app already collected the precise address and landmark.
The customer's presence at home AND their floor are already known to the app
— DO NOT ask either. Your call must confirm only:
1. the building color
2. practical directions that help a technician find the home from the landmark
   or nearby road

Known app context:
- Typed full address from app: ${ta}
- Confirmed landmark from app: ${cl}

${landmarkVariantBlock}

Required verification fields:
- building_color: color of the building/house/front side, in the customer's own words
- customer_direction: a practical direction note from a road/turn/landmark to
  the home, in the customer's own words

Conversation rules:
- Speak in simple Hinglish.
- Speak loudly, slowly, and clearly, like a phone support agent.
- Opening line must be exactly: "Building ka color kya hai?"
- Do not say any prefix before the opening line. Never start with "Bilkul",
  "Theek hai", "Namaste", "Hello", or "Haan".
- NEVER ask "kya aap abhi ghar par hain" or any variation — presence is already
  confirmed by the app's booking flow. Always set is_currently_at_home=true in
  the final tool call.
- NEVER ask "aapka floor kaunsa hai" or any variation — floor is already
  captured by the app. Always set floor="" (empty string) in the final tool
  call.
- Never ask the customer to repeat the full address.
- Never replace, rewrite, or infer the typed full address from speech.
- Never ask them to restate the confirmed landmark unless you need to phrase the
  direction question around it.
- If the user says the color is mixed, faded, or not sure, capture the closest
  useful description in their own words.
- After capturing color, ask for a practical direction note. The direction must
  help a technician find the door, e.g. "Jharsa Road se pehle right lo, mandir
  dikhega, mera ghar mandir ke bagal mein hai."
- If the customer gives a vague direction like "landmark ke paas hai", ask once
  for more specific turn/gali/door-facing detail.
- Ask one short follow-up at a time.
- Do not explain the process unless the customer asks.
- Match the customer's spoken language/register. If the customer speaks mostly
  Hindi, answer in Hindi/Hinglish. If the customer speaks English, answer in
  English. If they mix, mirror the mix.
- Speak numbers in the same language/register the customer is using. Examples:
  if the customer says "sector saintis" or "sector saintees", say "saintis";
  if they say "sector thirty seven", say "thirty seven"; if they say "plot
  pandrah sau chauvan", say the number back that way, not as English digits.
- Do not ask for fields already provided in this call.
- When required verification fields are complete, summarize only the verification
  facts, not the full address: "Building color ___ hai, aur direction ___ hai.
  Sahi?"
- Do not call the submit_address_packet tool until the customer confirms by
  voice with a clear yes/haan/sahi/confirm/ok.
- If the customer corrects building color or direction during confirmation,
  update it, summarize again, and ask for confirmation again.
- After confirmation, say one short closing line like "Theek hai, verification
  ho gaya" and then call the submit_address_packet tool with
  is_currently_at_home=true and floor="".

Completion criteria:
- building_color is present, customer_direction is present, and customer has
  explicitly confirmed the spoken verification summary.
- is_currently_at_home is always true (do not ask).
- floor is always "" (do not ask).

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

export async function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin") || "";
  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin, context.env.ALLOWED_ORIGINS),
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin") || "";
  const cors = corsHeaders(origin, env.ALLOWED_ORIGINS);

  if (!env.OPENAI_API_KEY) {
    return new Response(
      JSON.stringify({ error: "OPENAI_API_KEY not configured on this Pages project" }),
      { status: 500, headers: { "Content-Type": "application/json", ...cors } }
    );
  }

  let body = {};
  try { body = await request.json(); } catch (_) {}
  const variant = body.variant === "D1" ? "D1" : "D2";
  const typedAddress = typeof body.address === "string" ? body.address.slice(0, 240) : "";
  const confirmedLandmark = typeof body.landmark === "string" ? body.landmark.slice(0, 120) : "";

  const instructions = buildInstructions({ variant, typedAddress, confirmedLandmark });

  const sessionConfig = {
    model: MODEL,
    voice: VOICE,
    instructions,
    modalities: ["audio", "text"],
    input_audio_transcription: { model: "gpt-4o-mini-transcribe", language: "hi" },
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
}

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin") || "";
  const cors = corsHeaders(origin, context.env.ALLOWED_ORIGINS);
  return new Response(JSON.stringify({ ok: true, model: MODEL }), {
    headers: { "Content-Type": "application/json", ...cors },
  });
}
