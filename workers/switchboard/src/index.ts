// workers/switchboard/src/index.ts
// Sovereign AI Switchboard — Hono v4 Cloudflare Worker
// Entry point: all routes, middleware, CORS, rate-limiting, error handling.

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { timing } from "hono/timing";
import { z } from "zod";

import { SupabaseClient } from "./supabase_client";
import { FoundryClient } from "./foundry_client";
import {
  generateStructured,
  streamAI,
  probeAI,
  embedText,
  MODELS,
} from "./ai_client";
import { sdkStreamToSse } from "./stream_helpers";
import {
  DispatchRequestSchema,
  AlignmentRequestSchema,
  AlignmentResponseSchema,
  CompressionRequestSchema,
  CompressionResponseSchema,
  DefragRequestSchema,
  DefragResponseSchema,
  LoopRequestSchema,
  WebhookEventSchema,
  type AlignmentResponse,
  type CompressionResponse,
  type DefragResponse,
  type HealthResponse,
} from "./schemas";

// ─── Env bindings (declared in wrangler.toml) ─────────────────────────────────

export interface Env {
  GEMINI_API_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  FOUNDRY_API_URL: string;
  FOUNDRY_API_KEY: string;
  WORKER_HMAC_SECRET: string;
  SENTRY_DSN?: string;
  DATADOG_API_KEY?: string;
  ENVIRONMENT: string; // "staging" | "production"
}

// ─── Allowed origins ──────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = [
  "https://sovereign.os",
  "https://www.sovereign.os",
  "https://staging.sovereign.os",
  "http://localhost:3000",
  "http://localhost:3001",
];

// ─── Rate limit config per space ──────────────────────────────────────────────

const RATE_LIMITS: Record<string, { windowHours: number; max: number } | null> = {
  launcher: null,       // unlimited
  defrag: { windowHours: 24, max: 3 },
  alignment: { windowHours: 24, max: 5 },
  the_loop: { windowHours: 24, max: 3 },
  compression: null,    // pro — unlimited
  covenant: null,       // pro — unlimited
};

// ─── Pro-only spaces ──────────────────────────────────────────────────────────

const PRO_SPACES = new Set(["compression", "covenant"]);

// ─── App ──────────────────────────────────────────────────────────────────────

const app = new Hono<{ Bindings: Env }>();

// ─── Global middleware ────────────────────────────────────────────────────────

app.use("*", timing());
app.use("*", logger());
app.use(
  "*",
  secureHeaders({
    xContentTypeOptions: "nosniff",
    xFrameOptions: "DENY",
    referrerPolicy: "strict-origin-when-cross-origin",
  })
);

app.use(
  "*",
  cors({
    origin: (origin) => (ALLOWED_ORIGINS.includes(origin) ? origin : null),
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Idempotency-Key", "X-Request-ID"],
    exposeHeaders: ["X-Request-ID", "X-RateLimit-Remaining"],
    maxAge: 86400,
    credentials: true,
  })
);

// ─── Request ID middleware ────────────────────────────────────────────────────

app.use("*", async (c, next) => {
  const requestId =
    c.req.header("X-Request-ID") ?? crypto.randomUUID();
  c.set("requestId" as never, requestId);
  await next();
  c.res.headers.set("X-Request-ID", requestId);
});

// ─── Request size guard (256 KB hard limit) ────────────────────────────────

app.use("/dispatch", async (c, next) => {
  const contentLength = c.req.header("Content-Length");
  if (contentLength && parseInt(contentLength, 10) > 256_000) {
    return c.json({ error: "Request body too large", code: "PAYLOAD_TOO_LARGE" }, 413);
  }
  return next();
});

// ─── /health ─────────────────────────────────────────────────────────────────

app.get("/health", async (c) => {
  const supabase = new SupabaseClient(c.env);
  const foundry = new FoundryClient(c.env);

  const [aiResult, dbResult, foundryResult] = await Promise.allSettled([
    probeAI(c.env),
    supabase
      .select("agent_runs", { select: "id", limit: 1 })
      .then(() => ({ ok: true, latency_ms: 0 }))
      .catch(() => ({ ok: false, latency_ms: 0 })),
    foundry.probe(),
  ]);

  const ai = aiResult.status === "fulfilled" ? aiResult.value : { ok: false, latency_ms: 0 };
  const db = dbResult.status === "fulfilled" ? dbResult.value : { ok: false, latency_ms: 0 };
  const fd = foundryResult.status === "fulfilled" ? foundryResult.value : { ok: false, latency_ms: 0 };

  const allHealthy = ai.ok && db.ok;
  const status: HealthResponse["status"] = allHealthy
    ? "healthy"
    : ai.ok || db.ok
    ? "degraded"
    : "unhealthy";

  const body: HealthResponse = {
    status,
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    checks: {
      supabase: db.ok ? "ok" : "error",
      ai: ai.ok ? "ok" : "error",
      foundry: fd.ok ? "ok" : "error",
    },
    latency_ms: {
      ai: ai.latency_ms,
      db: db.latency_ms,
      foundry: fd.latency_ms,
    },
  };

  return c.json(body, allHealthy ? 200 : 503);
});

// ─── /dispatch ────────────────────────────────────────────────────────────────

app.post("/dispatch", async (c) => {
  const requestId = (c.get("requestId" as never) as string) ?? crypto.randomUUID();

  // --- Parse outer envelope
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON", code: "BAD_REQUEST", request_id: requestId }, 400);
  }

  const envelope = DispatchRequestSchema.safeParse(body);
  if (!envelope.success) {
    return c.json(
      { error: "Validation failed", code: "VALIDATION_ERROR", details: envelope.error.flatten(), request_id: requestId },
      422
    );
  }

  const { space, user_id, payload, idempotency_key } = envelope.data;
  const supabase = new SupabaseClient(c.env);

  // --- Idempotency check (webhook-grade — store key to prevent double-exec)
  if (idempotency_key) {
    const existing = await supabase
      .selectOne("agent_runs", {
        filters: { idempotency_key, user_id },
        select: "id,status",
      })
      .catch(() => null);
    if (existing) {
      return c.json({ cached: true, message: "Idempotent response" }, 200);
    }
  }

  // --- Pro gate
  if (PRO_SPACES.has(space)) {
    const profile = await supabase
      .selectOne<{ tier: string }>("profiles", {
        filters: { id: user_id },
        select: "tier",
      })
      .catch(() => null);
    if (!profile || profile.tier !== "pro") {
      return c.json(
        { error: "Pro subscription required", code: "UPGRADE_REQUIRED", request_id: requestId },
        403
      );
    }
  }

  // --- Rate limit check (free spaces)
  const rateConfig = RATE_LIMITS[space];
  if (rateConfig) {
    const { allowed, remaining } = await supabase.checkRateLimit(
      user_id,
      space,
      rateConfig.windowHours,
      rateConfig.max
    );
    c.res.headers.set("X-RateLimit-Remaining", String(remaining));
    if (!allowed) {
      return c.json(
        { error: "Daily limit reached. Come back tomorrow.", code: "RATE_LIMITED", request_id: requestId },
        429
      );
    }
  }

  // --- Route to space handler
  try {
    switch (space) {
      case "alignment":
        return handleAlignment(c, user_id, payload, requestId, supabase, idempotency_key);
      case "compression":
        return handleCompression(c, user_id, payload, requestId, supabase, idempotency_key);
      case "defrag":
        return handleDefrag(c, user_id, payload, requestId, supabase, idempotency_key);
      case "the_loop":
        return handleLoop(c, user_id, payload, requestId, supabase);
      case "launcher":
        return handleLauncher(c, user_id, payload, requestId, supabase);
      case "covenant":
        return handleCovenant(c, user_id, payload, requestId, supabase, idempotency_key);
      default:
        return c.json({ error: "Unknown space", code: "NOT_FOUND", request_id: requestId }, 404);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    await supabase.logRun({
      user_id,
      space,
      model: "unknown",
      status: "error",
      error: message,
      idempotency_key,
    });
    return c.json({ error: "Something went wrong. Please try again.", code: "INTERNAL_ERROR", request_id: requestId }, 500);
  }
});

// ─── Space handlers ────────────────────────────────────────────────────────────

async function handleAlignment(
  c: Parameters<typeof app.post>[1] extends (c: infer C, ...a: never[]) => never ? C : never,
  userId: string,
  payload: Record<string, unknown>,
  requestId: string,
  supabase: SupabaseClient,
  idempotencyKey?: string
) {
  const parsed = AlignmentRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return c.json(
      { error: "Invalid alignment payload", code: "VALIDATION_ERROR", details: parsed.error.flatten(), request_id: requestId },
      422
    );
  }

  const { dob, time_of_birth, timezone, question, depth } = parsed.data;
  const start = Date.now();

  const system = `You are the Alignment guide within Sovereign OS — a reflective astro-psychological intelligence. 
You help users understand themselves through the lens of natal chart archetypes and Jungian depth psychology.
Never use: generate, process, analyze, data, model, diagnose, pattern-match, algorithm.
Always use: understand, discover, explore, find, feel, guide, reflect, move forward.
Output strictly valid JSON matching the schema. No markdown code fences.`;

  const prompt = `User's date of birth: ${dob}
Time of birth: ${time_of_birth ?? "unknown"}
Timezone: ${timezone}
Depth: ${depth}
${question ? `Question: ${question}` : "Provide a general natal reading."}

Respond with a JSON object: { reading, archetypes (array, max 5), guidance, themes (array, max 7), generated_at (ISO datetime) }`;

  const result = await generateStructured<AlignmentResponse>({
    env: c.env,
    modelKey: depth === "deep" ? "pro" : "flash",
    schema: AlignmentResponseSchema,
    schemaName: "AlignmentResponse",
    system,
    prompt,
    temperature: 0.6,
    maxTokens: depth === "deep" ? 3000 : 1200,
  });

  const latency = Date.now() - start;
  await supabase.logRun({
    user_id: userId,
    space: "alignment",
    model: depth === "deep" ? MODELS.pro : MODELS.flash,
    input_tokens: result.usage?.promptTokens,
    output_tokens: result.usage?.completionTokens,
    latency_ms: latency,
    status: "success",
    idempotency_key: idempotencyKey,
  });

  return c.json(result.object, 200);
}

async function handleCompression(
  c: Parameters<typeof app.post>[1] extends (c: infer C, ...a: never[]) => never ? C : never,
  userId: string,
  payload: Record<string, unknown>,
  requestId: string,
  supabase: SupabaseClient,
  idempotencyKey?: string
) {
  const parsed = CompressionRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return c.json(
      { error: "Invalid compression payload", code: "VALIDATION_ERROR", details: parsed.error.flatten(), request_id: requestId },
      422
    );
  }

  const { content, mode, output_format, preserve_voice } = parsed.data;
  const wordCountOriginal = content.split(/\s+/).filter(Boolean).length;
  const start = Date.now();

  const system = `You are Compression within Sovereign OS — you help users distill, reframe, and crystallise their thoughts.
Never use: generate, process, analyze, data, model, diagnose, pattern-match, algorithm.
Always use: understand, discover, explore, find, feel, guide, reflect, move forward.
${preserve_voice ? "Preserve the user's authentic voice and tone." : ""}
Output strictly valid JSON. No markdown fences.`;

  const prompt = `Mode: ${mode}. Output format: ${output_format}.
Content to ${mode}:
${content}

Respond with JSON: { compressed (string), word_count_original (${wordCountOriginal}), word_count_compressed (int), compression_ratio (float 0-1), mode ("${mode}"), generated_at (ISO datetime) }`;

  const result = await generateStructured<CompressionResponse>({
    env: c.env,
    modelKey: "flash",
    schema: CompressionResponseSchema,
    schemaName: "CompressionResponse",
    system,
    prompt,
    temperature: 0.4,
    maxTokens: 2048,
  });

  const latency = Date.now() - start;
  await supabase.logRun({
    user_id: userId,
    space: "compression",
    model: MODELS.flash,
    input_tokens: result.usage?.promptTokens,
    output_tokens: result.usage?.completionTokens,
    latency_ms: latency,
    status: "success",
    idempotency_key: idempotencyKey,
  });

  return c.json(result.object, 200);
}

async function handleDefrag(
  c: Parameters<typeof app.post>[1] extends (c: infer C, ...a: never[]) => never ? C : never,
  userId: string,
  payload: Record<string, unknown>,
  requestId: string,
  supabase: SupabaseClient,
  idempotencyKey?: string
) {
  const parsed = DefragRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return c.json(
      { error: "Invalid defrag payload", code: "VALIDATION_ERROR", details: parsed.error.flatten(), request_id: requestId },
      422
    );
  }

  const { entries, goal, output_format } = parsed.data;
  const start = Date.now();

  const system = `You are Defrag within Sovereign OS — you help users find hidden structure in their scattered thoughts.
Never use: generate, process, analyze, data, model, diagnose, pattern-match, algorithm.
Always use: understand, discover, explore, find, feel, guide, reflect, move forward.
Output strictly valid JSON. No markdown fences.`;

  const prompt = `Format: ${output_format}. Goal: ${goal ?? "surface natural clusters and insights"}.
Entries (${entries.length}):
${entries.map((e) => `[${e.id}] ${e.text}`).join("\n")}

Respond with JSON: { clusters: [{ label, theme, entry_ids, insight }], overall_pattern, next_focus, generated_at }`;

  const result = await generateStructured<DefragResponse>({
    env: c.env,
    modelKey: "flash",
    schema: DefragResponseSchema,
    schemaName: "DefragResponse",
    system,
    prompt,
    temperature: 0.5,
    maxTokens: 2000,
  });

  const latency = Date.now() - start;
  await supabase.logRun({
    user_id: userId,
    space: "defrag",
    model: MODELS.flash,
    latency_ms: latency,
    status: "success",
    idempotency_key: idempotencyKey,
  });

  return c.json(result.object, 200);
}

async function handleLoop(
  c: Parameters<typeof app.post>[1] extends (c: infer C, ...a: never[]) => never ? C : never,
  userId: string,
  payload: Record<string, unknown>,
  requestId: string,
  supabase: SupabaseClient
) {
  const parsed = LoopRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return c.json(
      { error: "Invalid loop payload", code: "VALIDATION_ERROR", details: parsed.error.flatten(), request_id: requestId },
      422
    );
  }

  const { agent_id, message, conversation_id, stream, embed } = parsed.data;

  // Load agent manifest from Supabase
  const agent = await supabase
    .selectOne<{ system_prompt: string; model_preference: string; max_tokens: number; temperature: number }>("agent_manifests", {
      filters: { id: agent_id },
      select: "system_prompt,model_preference,max_tokens,temperature",
    })
    .catch(() => null);

  if (!agent) {
    return c.json({ error: "Agent not found", code: "NOT_FOUND", request_id: requestId }, 404);
  }

  // Store message in loop_messages
  const convId = conversation_id ?? crypto.randomUUID();
  await supabase.insert("loop_messages", {
    conversation_id: convId,
    user_id: userId,
    agent_id,
    role: "user",
    content: message,
    created_at: new Date().toISOString(),
  }).catch(() => {});

  // Generate embedding if requested
  if (embed) {
    const embedding = await embedText(c.env, message, "RETRIEVAL_DOCUMENT").catch(() => null);
    if (embedding) {
      await supabase.update(
        "loop_messages",
        { embedding: JSON.stringify(embedding) },
        { conversation_id: convId, role: "user" }
      ).catch(() => {});
    }
  }

  const modelKey = agent.model_preference === "gemini-1.5-pro" ? "pro" : "flash";

  if (stream) {
    const result = streamAI({
      env: c.env,
      modelKey,
      system: agent.system_prompt,
      messages: [{ role: "user", content: message }],
      temperature: agent.temperature,
      maxTokens: agent.max_tokens,
      abortSignal: c.req.raw.signal ?? undefined,
    });

    // Store assistant response async (best-effort)
    result.text.then((text) => {
      supabase.insert("loop_messages", {
        conversation_id: convId,
        user_id: userId,
        agent_id,
        role: "assistant",
        content: text,
        created_at: new Date().toISOString(),
      }).catch(() => {});
      supabase.logRun({ user_id: userId, space: "the_loop", model: agent.model_preference, status: "success" }).catch(() => {});
    }).catch(() => {});

    return sdkStreamToSse(result);
  }

  // Non-streaming fallback
  const { generateText } = await import("ai");
  const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
  const google = createGoogleGenerativeAI({ apiKey: c.env.GEMINI_API_KEY });
  const res = await generateText({
    model: google(agent.model_preference),
    system: agent.system_prompt,
    messages: [{ role: "user", content: message }],
    temperature: agent.temperature,
    maxTokens: agent.max_tokens,
  });

  await supabase.insert("loop_messages", {
    conversation_id: convId,
    user_id: userId,
    agent_id,
    role: "assistant",
    content: res.text,
    created_at: new Date().toISOString(),
  }).catch(() => {});

  return c.json({ text: res.text, conversation_id: convId, generated_at: new Date().toISOString() }, 200);
}

async function handleLauncher(
  c: Parameters<typeof app.post>[1] extends (c: infer C, ...a: never[]) => never ? C : never,
  userId: string,
  payload: Record<string, unknown>,
  requestId: string,
  supabase: SupabaseClient
) {
  // Launcher is the entry-point selector — routes to appropriate sub-space
  const intent = z
    .object({ intent: z.string().min(1).max(2000) })
    .safeParse(payload);

  if (!intent.success) {
    return c.json({ error: "Provide an intent string", code: "VALIDATION_ERROR", request_id: requestId }, 422);
  }

  const system = `You are the Sovereign OS Launcher — a routing intelligence that guides users to the right space.
Available spaces: defrag (scatter→structure), alignment (self-understanding), the_loop (agent conversation), compression (distill content), covenant (commitments).
Output JSON: { suggested_space: string, reason: string, opening_question: string }`;

  const result = await generateStructured({
    env: c.env,
    modelKey: "flash",
    schema: z.object({
      suggested_space: z.string(),
      reason: z.string(),
      opening_question: z.string(),
    }),
    schemaName: "LauncherResponse",
    system,
    prompt: `User intent: ${intent.data.intent}`,
    temperature: 0.5,
    maxTokens: 256,
  });

  await supabase.logRun({ user_id: userId, space: "launcher", model: MODELS.flash, status: "success" }).catch(() => {});
  return c.json(result.object, 200);
}

async function handleCovenant(
  c: Parameters<typeof app.post>[1] extends (c: infer C, ...a: never[]) => never ? C : never,
  userId: string,
  payload: Record<string, unknown>,
  requestId: string,
  supabase: SupabaseClient,
  idempotencyKey?: string
) {
  const parsed = z
    .object({
      commitment: z.string().min(10).max(2000),
      timeframe: z.string().max(100).optional(),
      reflection: z.string().max(2000).optional(),
    })
    .safeParse(payload);

  if (!parsed.success) {
    return c.json({ error: "Invalid covenant payload", code: "VALIDATION_ERROR", request_id: requestId }, 422);
  }

  const { commitment, timeframe, reflection } = parsed.data;
  const system = `You are Covenant within Sovereign OS — a sacred space for making and honouring meaningful commitments.
Help the user clarify, deepen, and find accountability in their commitments.
Never use clinical or algorithmic language. Be warm, grounding, and present.
Output JSON: { covenant_statement, witness_reflection, check_in_questions (array, max 3), generated_at }`;

  const result = await generateStructured({
    env: c.env,
    modelKey: "pro",
    schema: z.object({
      covenant_statement: z.string(),
      witness_reflection: z.string(),
      check_in_questions: z.array(z.string()).max(3),
      generated_at: z.string(),
    }),
    schemaName: "CovenantResponse",
    system,
    prompt: `Commitment: ${commitment}\nTimeframe: ${timeframe ?? "open"}\nReflection: ${reflection ?? "none"}`,
    temperature: 0.65,
    maxTokens: 1500,
  });

  await supabase.logRun({ user_id: userId, space: "covenant", model: MODELS.pro, status: "success", idempotency_key: idempotencyKey }).catch(() => {});
  return c.json(result.object, 200);
}

// ─── /webhook ────────────────────────────────────────────────────────────────

app.post("/webhook", async (c) => {
  // HMAC-SHA256 verification
  const signature = c.req.header("X-Sovereign-Signature");
  const rawBody = await c.req.text();

  if (!signature) {
    return c.json({ error: "Missing signature", code: "UNAUTHORIZED" }, 401);
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(c.env.WORKER_HMAC_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const sigBytes = hexToBytes(signature);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    sigBytes,
    new TextEncoder().encode(rawBody)
  );

  if (!valid) {
    return c.json({ error: "Invalid signature", code: "FORBIDDEN" }, 403);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "Invalid JSON", code: "BAD_REQUEST" }, 400);
  }

  const event = WebhookEventSchema.safeParse(body);
  if (!event.success) {
    return c.json({ error: "Unknown event type", code: "VALIDATION_ERROR" }, 422);
  }

  const supabase = new SupabaseClient(c.env);

  switch (event.data.type) {
    case "stripe.checkout.session.completed": {
      const { user_id, plan, stripe_customer_id, stripe_subscription_id } = event.data.data;
      await supabase.upsert(
        "profiles",
        {
          id: user_id,
          tier: plan,
          stripe_customer_id,
          stripe_subscription_id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );
      break;
    }
    case "stripe.customer.subscription.deleted": {
      const { user_id } = event.data.data;
      await supabase.update("profiles", { tier: "free", stripe_subscription_id: null }, { id: user_id });
      break;
    }
  }

  return c.json({ received: true }, 200);
});

// ─── Global 404 & error handler ───────────────────────────────────────────────

app.notFound((c) => c.json({ error: "Route not found", code: "NOT_FOUND" }, 404));

app.onError((err, c) => {
  console.error("[switchboard] unhandled error:", err);
  return c.json({ error: "Internal server error", code: "INTERNAL_ERROR" }, 500);
});

// ─── Utilities ────────────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

// ─── Export ───────────────────────────────────────────────────────────────────

export default app;
