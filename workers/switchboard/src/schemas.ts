import { z } from "zod";

// ─── Shared primitives ────────────────────────────────────────────────────────

export const UUIDSchema = z.string().uuid();
export const TimestampSchema = z.string().datetime({ offset: true });

// ─── ALIGNMENT_SCHEMA ─────────────────────────────────────────────────────────

export const AlignmentRequestSchema = z.object({
  session_id: UUIDSchema,
  agent_id: UUIDSchema,
  design_id: UUIDSchema.optional(),
  prompt: z.string().min(1).max(32_000),
  context_window: z.array(z.string()).max(20).default([]),
  temperature: z.number().min(0).max(2).default(0.3),
  stream: z.boolean().default(false),
  idempotency_key: z.string().max(128).optional(),
});

export type AlignmentRequest = z.infer<typeof AlignmentRequestSchema>;

export const AlignmentResultSchema = z.object({
  session_id: UUIDSchema,
  agent_id: UUIDSchema,
  status: z.enum(["aligned", "misaligned", "uncertain"]),
  score: z.number().min(0).max(1),
  reasoning: z.string(),
  recommendations: z.array(z.string()).max(10),
  token_usage: z.object({
    prompt_tokens: z.number().int().nonnegative(),
    completion_tokens: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative(),
  }),
  latency_ms: z.number().nonnegative(),
  model: z.string(),
  created_at: TimestampSchema,
});

export type AlignmentResult = z.infer<typeof AlignmentResultSchema>;

// ─── COMPRESSION_SCHEMA ───────────────────────────────────────────────────────

export const CompressionRequestSchema = z.object({
  session_id: UUIDSchema,
  content: z.string().min(1).max(128_000),
  target_ratio: z.number().min(0.05).max(0.95).default(0.25),
  preserve_keys: z.array(z.string()).max(50).default([]),
  format: z.enum(["summary", "bullet_points", "structured_json"]).default("summary"),
  idempotency_key: z.string().max(128).optional(),
});

export type CompressionRequest = z.infer<typeof CompressionRequestSchema>;

export const CompressionResultSchema = z.object({
  session_id: UUIDSchema,
  original_length: z.number().int().nonnegative(),
  compressed_length: z.number().int().nonnegative(),
  actual_ratio: z.number().min(0).max(1),
  compressed_content: z.string(),
  format: z.string(),
  token_usage: z.object({
    prompt_tokens: z.number().int().nonnegative(),
    completion_tokens: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative(),
  }),
  latency_ms: z.number().nonnegative(),
  model: z.string(),
  created_at: TimestampSchema,
});

export type CompressionResult = z.infer<typeof CompressionResultSchema>;

// ─── AGENT_MANIFEST ───────────────────────────────────────────────────────────

export const AgentCapabilitySchema = z.object({
  name: z.string(),
  description: z.string(),
  input_schema: z.record(z.unknown()),
  output_schema: z.record(z.unknown()),
});

export const AgentManifestSchema = z.object({
  agent_id: UUIDSchema,
  name: z.string().min(1).max(128),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().max(1024),
  capabilities: z.array(AgentCapabilitySchema).min(1).max(32),
  models: z.object({
    primary: z.string(),
    fallback: z.string().optional(),
    embedding: z.string().optional(),
  }),
  embedding_dim: z.number().int().positive().default(768),
  max_context_tokens: z.number().int().positive().default(128_000),
  rate_limits: z.object({
    requests_per_minute: z.number().int().positive().default(60),
    tokens_per_day: z.number().int().positive().default(1_000_000),
  }),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});

export type AgentManifest = z.infer<typeof AgentManifestSchema>;

// ─── DISPATCH envelope ────────────────────────────────────────────────────────

export const DispatchRequestSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("alignment"),
    payload: AlignmentRequestSchema,
  }),
  z.object({
    operation: z.literal("compression"),
    payload: CompressionRequestSchema,
  }),
  z.object({
    operation: z.literal("simulator"),
    payload: z.object({
      session_id: UUIDSchema,
      agent_id: UUIDSchema,
      loop_id: UUIDSchema.optional(),
      messages: z.array(
        z.object({
          role: z.enum(["user", "assistant", "system"]),
          content: z.string().max(32_000),
        })
      ).min(1).max(100),
      max_tokens: z.number().int().min(1).max(8192).default(2048),
      temperature: z.number().min(0).max(2).default(0.7),
    }),
  }),
  z.object({
    operation: z.literal("embed"),
    payload: z.object({
      session_id: UUIDSchema,
      texts: z.array(z.string().min(1).max(8192)).min(1).max(100),
    }),
  }),
]);

export type DispatchRequest = z.infer<typeof DispatchRequestSchema>;

// ─── WEBHOOK envelope ────────────────────────────────────────────────────────

export const WebhookEventSchema = z.object({
  event_id: UUIDSchema,
  event_type: z.enum([
    "agent.run.completed",
    "agent.run.failed",
    "loop.message.created",
    "design.baseline.updated",
    "billing.usage.threshold",
  ]),
  idempotency_key: z.string().max(128),
  occurred_at: TimestampSchema,
  data: z.record(z.unknown()),
  signature: z.string().optional(),
});

export type WebhookEvent = z.infer<typeof WebhookEventSchema>;

// ─── Error envelope ───────────────────────────────────────────────────────────

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    request_id: z.string().optional(),
    retryable: z.boolean().default(false),
    details: z.unknown().optional(),
  }),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
