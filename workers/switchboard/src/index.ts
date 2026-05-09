/**
 * index.ts — Sovereign AI Switchboard
 * Cloudflare Worker using Hono v4
 * Routes: /dispatch, /health, /webhook
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { logger } from "hono/logger";
import { timing } from "hono/timing";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { nanoid } from "nanoid";

import {
  DispatchRequestSchema,
  AlignmentRequestSchema,
  CompressionRequestSchema,
  WebhookEventSchema,
  type ErrorResponse,
} from "./schemas";
import {
  runAlignment,
  runCompression,
  runSimulatorStream,
  embedTexts,
  probeAI,
} from "./ai_client";
import {
  sdkStreamToSSE,
  sdkStreamToNDJSON,
  withStreamTimeout,
  readBodyWithLimit,
} from "./stream_helpers";
import {
  createSupabaseClient,
  insertAgentRun,
  completeAgentRun,
  insertLoopMessage,
  SupabaseError,
} from "./supabase_client";
import { createFoundryClient } from "./foundry_client";

// ─── Env bindings (matches wrangler.toml) ─────────────────────────────────────

export interface Env {
  GEMINI_API_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  FOUNDRY_API_URL: string;
  FOUNDRY_API_KEY: string;
  SENTRY_DSN?: string;
  DATADOG_API_KEY?: string;
  S3_BUCKET?: string;
  S3_KEY?: string;
  S3_SECRET?: string;
  /** Set to "staging" | "production" */
  ENVIRONMENT: string;
  /** Shared secret for webhook signature verification */
  WEBHOOK_SECRET: string;
}

// ─── Allowed origins (tightened CORS) ────────────────────────────────────────

const ALLOWED_ORIGINS = [
  "https://sovereign.os",
  "https://www.sovereign.os",
  "https://app.sovereign.os",
  // Vercel preview URLs
  /^https:\/\/sovereign.*\.vercel\.app$/,
];

function isOriginAllowed(origin: string): boolean {
  return ALLOWED_ORIGINS.some((o) =>
    typeof o === "string" ? o === origin : o.test(origin)
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

const app = new Hono<{ Bindings: Env }>();

// ── Middleware ────────────────────────────────────────────────────────────────

app.use("*", timing());
app.use("*", logger());
app.use("*", secureHeaders());

// Dynamic CORS — allow listed origins only
app.use("*", async (c, next) => {
  const origin = c.req.header("origin") ?? "";
  const allowed = isOriginAllowed(origin);

  if (c.req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": allowed ? origin : "",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Idempotency-Key",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      },
    });
  }

  await next();

  if (allowed) {
    c.res.headers.set("Access-Control-Allow-Origin", origin);
    c.res.headers.set("Vary", "Origin");
  }
});

// Request ID injection
app.use("*", async (c, next) => {
  const requestId = c.req.header("x-request-id") ?? nanoid(16);
  c.set("requestId" as never, requestId);
  await next();
  c.res.headers.set("X-Request-Id", requestId);
});

// ── Error handler ─────────────────────────────────────────────────────────────

app.onError((err, c) => {
  const requestId = (c.get("requestId" as never) as string) ?? "unknown";
  console.error(`[${requestId}] Unhandled error:`, err);

  if (err instanceof HTTPException) {
    return c.json<ErrorResponse>(
      {
        error: {
          code: "HTTP_EXCEPTION",
          message: err.message,
          request_id: requestId,
          retryable: err.status >= 500,
        },
      },
      err.status as Parameters<typeof c.json>[1]
    );
  }

  const status = (err as { status?: number }).status ?? 500;
  const code = (err as { code?: string }).code ?? "INTERNAL_ERROR";

  return c.json<ErrorResponse>(
    {
      error: {
        code,
        message: err.message ?? "An unexpected error occurred",
        request_id: requestId,
        retryable: status >= 500,
      },
    },
    status as Parameters<typeof c.json>[1]
  );
});

// ── /health ───────────────────────────────────────────────────────────────────

app.get("/health", async (c) => {
  const env = c.env;
  const db = createSupabaseClient(env);

  const [dbProbe, aiProbe] = await Promise.allSettled([
    db.probe(),
    probeAI(env.GEMINI_API_KEY),
  ]);

  const dbResult =
    dbProbe.status === "fulfilled"
      ? dbProbe.value
      : { ok: false, latency_ms: -1 };
  const aiResult =
    aiProbe.status === "fulfilled"
      ? aiProbe.value
      : { ok: false, latency_ms: -1 };

  const healthy = dbResult.ok && aiResult.ok;

  return c.json(
    {
      status: healthy ? "healthy" : "degraded",
      environment: env.ENVIRONMENT ?? "unknown",
      checks: {
        database: { ok: dbResult.ok, latency_ms: dbResult.latency_ms },
        ai: { ok: aiResult.ok, latency_ms: aiResult.latency_ms },
      },
      timestamp: new Date().toISOString(),
    },
    healthy ? 200 : 503
  );
});

// ── /dispatch ─────────────────────────────────────────────────────────────────

app.post("/dispatch", async (c) => {
  const requestId = (c.get("requestId" as never) as string) ?? nanoid(16);
  const env = c.env;
  const db = createSupabaseClient(env);
  const runId = nanoid(21);
  const now = new Date().toISOString();

  // Parse body
  let rawBody: unknown;
  try {
    rawBody = await readBodyWithLimit(c.req.raw, 512_000);
  } catch (err: unknown) {
    const e = err as { status?: number; code?: string; message?: string };
    return c.json<ErrorResponse>(
      {
        error: {
          code: e.code ?? "PARSE_ERROR",
          message: e.message ?? "Failed to parse request body",
          request_id: requestId,
          retryable: false,
        },
      },
      (e.status ?? 400) as Parameters<typeof c.json>[1]
    );
  }

  // Validate dispatch envelope
  const parseResult = DispatchRequestSchema.safeParse(rawBody);
  if (!parseResult.success) {
    return c.json<ErrorResponse>(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Request body does not match expected schema",
          request_id: requestId,
          retryable: false,
          details: parseResult.error.flatten(),
        },
      },
      422
    );
  }

  const dispatch = parseResult.data;
  const idempotencyKey =
    c.req.header("x-idempotency-key") ??
    ("idempotency_key" in dispatch.payload ? dispatch.payload.idempotency_key : undefined);

  // ── ALIGNMENT ──────────────────────────────────────────────────────────────

  if (dispatch.operation === "alignment") {
    const req = dispatch.payload;
    const t0 = Date.now();

    // Record run start
    await insertAgentRun(db, {
      id: runId,
      agent_id: req.agent_id,
      session_id: req.session_id,
      operation: "alignment",
      status: "running",
      input_summary: req.prompt.slice(0, 256),
      created_at: now,
    }).catch(() => {/* non-fatal — don't block on DB write */});

    // Streaming path
    if (req.stream) {
      return withStreamTimeout(async () => {
        const { runSimulatorStream: _, ...aiMod } = await import("./ai_client");
        const streamResult = await import("./ai_client").then((m) =>
          m.runSimulatorStream(
            env.GEMINI_API_KEY,
            [
              {
                role: "system" as const,
                content:
                  "You are SOVEREIGN ALIGNMENT EVALUATOR. Provide streaming alignment analysis.",
              },
              { role: "user" as const, content: req.prompt },
            ],
            2048,
            req.temperature
          )
        );
        return sdkStreamToSSE(streamResult, req.session_id);
      }, 25_000);
    }

    // Non-streaming — structured JSON
    try {
      const result = await runAlignment(
        env.GEMINI_API_KEY,
        req.prompt,
        req.context_window,
        req.temperature
      );

      const output = {
        session_id: req.session_id,
        agent_id: req.agent_id,
        status: result.status,
        score: result.score,
        reasoning: result.reasoning,
        recommendations: result.recommendations,
        token_usage: result.usage,
        latency_ms: result.latency_ms,
        model: result.model,
        created_at: now,
      };

      // Persist result
      await completeAgentRun(db, runId, {
        status: "completed",
        output_summary: `score=${result.score} status=${result.status}`,
        token_usage: result.usage,
        completed_at: new Date().toISOString(),
      }).catch(() => {});

      return c.json(output, 200);
    } catch (err) {
      await completeAgentRun(db, runId, {
        status: "failed",
        error_message: err instanceof Error ? err.message : "Unknown error",
        completed_at: new Date().toISOString(),
      }).catch(() => {});
      throw err;
    }
  }

  // ── COMPRESSION ────────────────────────────────────────────────────────────

  if (dispatch.operation === "compression") {
    const req = dispatch.payload;
    const t0 = Date.now();

    await insertAgentRun(db, {
      id: runId,
      agent_id: "compression-agent",
      session_id: req.session_id,
      operation: "compression",
      status: "running",
      input_summary: `len=${req.content.length} ratio=${req.target_ratio}`,
      created_at: now,
    }).catch(() => {});

    try {
      const result = await runCompression(
        env.GEMINI_API_KEY,
        req.content,
        req.target_ratio,
        req.preserve_keys,
        req.format
      );

      const output = {
        session_id: req.session_id,
        original_length: req.content.length,
        compressed_length: result.compressed_content.length,
        actual_ratio: result.compressed_content.length / req.content.length,
        compressed_content: result.compressed_content,
        format: req.format,
        token_usage: result.usage,
        latency_ms: result.latency_ms,
        model: result.model,
        created_at: now,
      };

      await completeAgentRun(db, runId, {
        status: "completed",
        output_summary: `compressed ${req.content.length}→${result.compressed_content.length}`,
        token_usage: result.usage,
        completed_at: new Date().toISOString(),
      }).catch(() => {});

      return c.json(output, 200);
    } catch (err) {
      await completeAgentRun(db, runId, {
        status: "failed",
        error_message: err instanceof Error ? err.message : "Unknown error",
        completed_at: new Date().toISOString(),
      }).catch(() => {});
      throw err;
    }
  }

  // ── SIMULATOR (streaming) ─────────────────────────────────────────────────

  if (dispatch.operation === "simulator") {
    const req = dispatch.payload;

    return withStreamTimeout(async () => {
      const streamResult = runSimulatorStream(
        env.GEMINI_API_KEY,
        req.messages as Parameters<typeof runSimulatorStream>[1],
        req.max_tokens,
        req.temperature
      );

      // Persist loop messages async
      (async () => {
        const lastUserMsg = [...req.messages].reverse().find((m) => m.role === "user");
        if (lastUserMsg && req.loop_id) {
          await insertLoopMessage(db, {
            id: nanoid(21),
            loop_id: req.loop_id,
            session_id: req.session_id,
            role: "user",
            content: lastUserMsg.content,
            created_at: now,
          }).catch(() => {});
        }
      })();

      const acceptHeader = c.req.header("accept") ?? "";
      if (acceptHeader.includes("application/x-ndjson")) {
        return sdkStreamToNDJSON(streamResult, req.session_id);
      }
      return sdkStreamToSSE(streamResult, req.session_id);
    }, 25_000);
  }

  // ── EMBED ─────────────────────────────────────────────────────────────────

  if (dispatch.operation === "embed") {
    const req = dispatch.payload;

    const result = await embedTexts(env.GEMINI_API_KEY, req.texts);

    return c.json(
      {
        session_id: req.session_id,
        embeddings: result.embeddings,
        model: result.model,
        dim: result.dim,
        count: result.embeddings.length,
        created_at: now,
      },
      200
    );
  }

  // Should never reach here (discriminated union exhausts all cases)
  return c.json<ErrorResponse>(
    {
      error: {
        code: "UNKNOWN_OPERATION",
        message: "Unsupported dispatch operation",
        request_id: requestId,
        retryable: false,
      },
    },
    400
  );
});

// ── /webhook ──────────────────────────────────────────────────────────────────

app.post("/webhook", async (c) => {
  const requestId = (c.get("requestId" as never) as string) ?? nanoid(16);
  const env = c.env;

  // Verify signature (HMAC-SHA256 over raw body)
  const rawBody = await c.req.text();
  const signature = c.req.header("x-sovereign-signature");

  if (env.WEBHOOK_SECRET && signature) {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(env.WEBHOOK_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const sigBytes = hexToBytes(signature.replace(/^sha256=/, ""));
    const bodyBytes = encoder.encode(rawBody);
    const valid = await crypto.subtle.verify("HMAC", key, sigBytes, bodyBytes);

    if (!valid) {
      return c.json<ErrorResponse>(
        {
          error: {
            code: "INVALID_SIGNATURE",
            message: "Webhook signature verification failed",
            request_id: requestId,
            retryable: false,
          },
        },
        401
      );
    }
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return c.json<ErrorResponse>(
      {
        error: { code: "PARSE_ERROR", message: "Invalid JSON body", request_id: requestId, retryable: false },
      },
      400
    );
  }

  const parseResult = WebhookEventSchema.safeParse(body);
  if (!parseResult.success) {
    return c.json<ErrorResponse>(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Webhook body does not match expected schema",
          request_id: requestId,
          retryable: false,
          details: parseResult.error.flatten(),
        },
      },
      422
    );
  }

  const event = parseResult.data;
  const db = createSupabaseClient(env);

  // Idempotency: store processed event ID (fire-and-forget)
  await db
    .insert(
      "webhook_events",
      {
        id: event.event_id,
        event_type: event.event_type,
        idempotency_key: event.idempotency_key,
        data: event.data,
        processed_at: new Date().toISOString(),
      },
      { onConflict: "idempotency_key", ignoreDuplicates: true }
    )
    .catch(() => {});

  // Route by event type
  switch (event.event_type) {
    case "agent.run.completed":
    case "agent.run.failed":
      console.log(`[webhook] ${event.event_type} – ${event.event_id}`);
      break;
    case "loop.message.created":
    case "design.baseline.updated":
      console.log(`[webhook] ${event.event_type} – ${event.event_id}`);
      break;
    case "billing.usage.threshold":
      console.warn(`[webhook] Billing threshold reached – ${JSON.stringify(event.data)}`);
      break;
  }

  return c.json({ received: true, event_id: event.event_id }, 200);
});

// ── 404 catch-all ─────────────────────────────────────────────────────────────

app.notFound((c) => {
  return c.json<ErrorResponse>(
    {
      error: {
        code: "NOT_FOUND",
        message: `Route ${c.req.method} ${c.req.path} not found`,
        retryable: false,
      },
    },
    404
  );
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// ─── Export ───────────────────────────────────────────────────────────────────

export default app;
