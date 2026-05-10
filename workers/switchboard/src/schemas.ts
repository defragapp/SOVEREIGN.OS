// workers/switchboard/src/schemas.ts
// Zod schemas for all Sovereign AI Switchboard payloads.
// Every route validates input and output against these schemas.

import { z } from "zod";

// ─── Shared primitives ────────────────────────────────────────────────────────

export const UserIdSchema = z.string().uuid({ message: "user_id must be a valid UUID" });

export const SpaceSchema = z.enum([
  "launcher",
  "defrag",
  "alignment",
  "the_loop",
  "compression",
  "covenant",
]);

export const TierSchema = z.enum(["free", "pro"]);

// ─── Dispatch envelope ────────────────────────────────────────────────────────

/** Every /dispatch request must include this outer envelope. */
export const DispatchRequestSchema = z.object({
  space: SpaceSchema,
  user_id: UserIdSchema,
  idempotency_key: z.string().min(1).max(128).optional(),
  payload: z.record(z.unknown()), // space-specific, validated below
});

export type DispatchRequest = z.infer<typeof DispatchRequestSchema>;

// ─── Alignment ────────────────────────────────────────────────────────────────

export const AlignmentRequestSchema = z.object({
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dob must be YYYY-MM-DD"),
  time_of_birth: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "time_of_birth must be HH:MM")
    .optional(),
  timezone: z.string().default("UTC"),
  question: z
    .string()
    .min(3, "question too short")
    .max(1200, "question too long")
    .optional(),
  depth: z.enum(["brief", "standard", "deep"]).default("standard"),
});

export type AlignmentRequest = z.infer<typeof AlignmentRequestSchema>;

export const AlignmentResponseSchema = z.object({
  reading: z.string(),
  archetypes: z.array(z.string()).max(5),
  guidance: z.string(),
  themes: z.array(z.string()).max(7),
  generated_at: z.string().datetime(),
});

export type AlignmentResponse = z.infer<typeof AlignmentResponseSchema>;

// ─── Compression ──────────────────────────────────────────────────────────────

export const CompressionRequestSchema = z.object({
  content: z.string().min(20, "content too short").max(40_000, "content exceeds 40k char limit"),
  mode: z.enum(["distill", "reframe", "crystallise"]).default("distill"),
  output_format: z.enum(["prose", "bullets", "structured"]).default("prose"),
  preserve_voice: z.boolean().default(true),
});

export type CompressionRequest = z.infer<typeof CompressionRequestSchema>;

export const CompressionResponseSchema = z.object({
  compressed: z.string(),
  word_count_original: z.number().int().nonnegative(),
  word_count_compressed: z.number().int().nonnegative(),
  compression_ratio: z.number().min(0).max(1),
  mode: z.string(),
  generated_at: z.string().datetime(),
});

export type CompressionResponse = z.infer<typeof CompressionResponseSchema>;

// ─── Defrag ───────────────────────────────────────────────────────────────────

export const DefragRequestSchema = z.object({
  entries: z
    .array(
      z.object({
        id: z.string(),
        text: z.string().max(4000),
        created_at: z.string().datetime().optional(),
      })
    )
    .min(1)
    .max(50),
  goal: z.string().max(500).optional(),
  output_format: z.enum(["clusters", "timeline", "priorities"]).default("clusters"),
});

export type DefragRequest = z.infer<typeof DefragRequestSchema>;

export const DefragResponseSchema = z.object({
  clusters: z.array(
    z.object({
      label: z.string(),
      theme: z.string(),
      entry_ids: z.array(z.string()),
      insight: z.string(),
    })
  ),
  overall_pattern: z.string(),
  next_focus: z.string(),
  generated_at: z.string().datetime(),
});

export type DefragResponse = z.infer<typeof DefragResponseSchema>;

// ─── The Loop (simulator / streaming) ────────────────────────────────────────

export const LoopRequestSchema = z.object({
  agent_id: z.string().uuid(),
  message: z.string().min(1).max(8000),
  conversation_id: z.string().uuid().optional(),
  stream: z.boolean().default(true),
  embed: z.boolean().default(false), // whether to store embedding
});

export type LoopRequest = z.infer<typeof LoopRequestSchema>;

// ─── Agent Manifest ───────────────────────────────────────────────────────────

export const AgentCapabilitySchema = z.enum([
  "alignment",
  "compression",
  "defrag",
  "simulation",
  "coaching",
  "synthesis",
]);

export const AgentManifestSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(80),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "version must be semver"),
  capabilities: z.array(AgentCapabilitySchema).min(1),
  model_preference: z
    .enum(["gemini-1.5-pro", "gemini-1.5-flash"])
    .default("gemini-1.5-flash"),
  system_prompt: z.string().max(8000),
  max_tokens: z.number().int().min(64).max(8192).default(1024),
  temperature: z.number().min(0).max(2).default(0.7),
  description: z.string().max(400).optional(),
  tags: z.array(z.string()).max(10).optional(),
});

export type AgentManifest = z.infer<typeof AgentManifestSchema>;

// ─── Health check ─────────────────────────────────────────────────────────────

export const HealthResponseSchema = z.object({
  status: z.enum(["healthy", "degraded", "unhealthy"]),
  version: z.string(),
  timestamp: z.string().datetime(),
  checks: z.object({
    supabase: z.enum(["ok", "error"]),
    ai: z.enum(["ok", "error"]),
    foundry: z.enum(["ok", "error", "skipped"]),
  }),
  latency_ms: z.record(z.number()),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

// ─── Webhook ──────────────────────────────────────────────────────────────────

export const WebhookEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("stripe.checkout.session.completed"),
    idempotency_key: z.string(),
    data: z.object({
      user_id: z.string(),
      plan: TierSchema,
      stripe_customer_id: z.string(),
      stripe_subscription_id: z.string(),
    }),
  }),
  z.object({
    type: z.literal("stripe.customer.subscription.deleted"),
    idempotency_key: z.string(),
    data: z.object({
      user_id: z.string(),
      stripe_subscription_id: z.string(),
    }),
  }),
]);

export type WebhookEvent = z.infer<typeof WebhookEventSchema>;

// ─── Error envelope ───────────────────────────────────────────────────────────

export const ApiErrorSchema = z.object({
  error: z.string(),
  code: z.string(),
  details: z.unknown().optional(),
  request_id: z.string().optional(),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;
