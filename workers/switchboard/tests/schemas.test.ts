/**
 * schemas.test.ts — Unit tests for all Zod schemas
 */

import { describe, it, expect } from "vitest";
import {
  AlignmentRequestSchema,
  AlignmentResultSchema,
  CompressionRequestSchema,
  CompressionResultSchema,
  AgentManifestSchema,
  DispatchRequestSchema,
  WebhookEventSchema,
} from "../src/schemas";

const SESSION_ID = "550e8400-e29b-41d4-a716-446655440000";
const AGENT_ID = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const NOW = new Date().toISOString();

// ─── AlignmentRequestSchema ───────────────────────────────────────────────────

describe("AlignmentRequestSchema", () => {
  const valid = {
    session_id: SESSION_ID,
    agent_id: AGENT_ID,
    prompt: "Evaluate agent decision: approve loan application for user XYZ.",
    context_window: ["Previous decision: denied", "Regulation: fair-lending"],
    temperature: 0.3,
    stream: false,
  };

  it("accepts a valid alignment request", () => {
    expect(AlignmentRequestSchema.safeParse(valid).success).toBe(true);
  });

  it("applies default temperature=0.3 when omitted", () => {
    const { temperature, ...without } = valid;
    const result = AlignmentRequestSchema.safeParse(without);
    expect(result.success && result.data.temperature).toBe(0.3);
  });

  it("applies default stream=false when omitted", () => {
    const { stream, ...without } = valid;
    const result = AlignmentRequestSchema.safeParse(without);
    expect(result.success && result.data.stream).toBe(false);
  });

  it("rejects invalid UUID for session_id", () => {
    expect(
      AlignmentRequestSchema.safeParse({ ...valid, session_id: "not-a-uuid" }).success
    ).toBe(false);
  });

  it("rejects empty prompt", () => {
    expect(AlignmentRequestSchema.safeParse({ ...valid, prompt: "" }).success).toBe(false);
  });

  it("rejects temperature > 2", () => {
    expect(AlignmentRequestSchema.safeParse({ ...valid, temperature: 2.5 }).success).toBe(false);
  });

  it("rejects context_window with >20 items", () => {
    const ctx = Array.from({ length: 21 }, (_, i) => `ctx${i}`);
    expect(AlignmentRequestSchema.safeParse({ ...valid, context_window: ctx }).success).toBe(false);
  });
});

// ─── CompressionRequestSchema ─────────────────────────────────────────────────

describe("CompressionRequestSchema", () => {
  const valid = {
    session_id: SESSION_ID,
    content: "This is a long document that needs to be compressed for context window efficiency.",
    target_ratio: 0.25,
    format: "summary" as const,
  };

  it("accepts a valid compression request", () => {
    expect(CompressionRequestSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects target_ratio=0 (too low)", () => {
    expect(CompressionRequestSchema.safeParse({ ...valid, target_ratio: 0 }).success).toBe(false);
  });

  it("rejects target_ratio=1 (no compression)", () => {
    expect(CompressionRequestSchema.safeParse({ ...valid, target_ratio: 1 }).success).toBe(false);
  });

  it("accepts all valid format values", () => {
    for (const fmt of ["summary", "bullet_points", "structured_json"]) {
      expect(
        CompressionRequestSchema.safeParse({ ...valid, format: fmt }).success
      ).toBe(true);
    }
  });

  it("rejects unknown format", () => {
    expect(
      CompressionRequestSchema.safeParse({ ...valid, format: "html" }).success
    ).toBe(false);
  });
});

// ─── DispatchRequestSchema ────────────────────────────────────────────────────

describe("DispatchRequestSchema", () => {
  it("routes alignment operation correctly", () => {
    const req = {
      operation: "alignment",
      payload: {
        session_id: SESSION_ID,
        agent_id: AGENT_ID,
        prompt: "Test prompt",
      },
    };
    const result = DispatchRequestSchema.safeParse(req);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.operation).toBe("alignment");
    }
  });

  it("routes compression operation correctly", () => {
    const req = {
      operation: "compression",
      payload: {
        session_id: SESSION_ID,
        content: "Content to compress",
        target_ratio: 0.3,
      },
    };
    const result = DispatchRequestSchema.safeParse(req);
    expect(result.success).toBe(true);
  });

  it("routes simulator operation correctly", () => {
    const req = {
      operation: "simulator",
      payload: {
        session_id: SESSION_ID,
        agent_id: AGENT_ID,
        messages: [{ role: "user", content: "Hello" }],
      },
    };
    const result = DispatchRequestSchema.safeParse(req);
    expect(result.success).toBe(true);
  });

  it("routes embed operation correctly", () => {
    const req = {
      operation: "embed",
      payload: {
        session_id: SESSION_ID,
        texts: ["Hello world", "Another text"],
      },
    };
    const result = DispatchRequestSchema.safeParse(req);
    expect(result.success).toBe(true);
  });

  it("rejects unknown operation", () => {
    const req = {
      operation: "unknown_op",
      payload: {},
    };
    expect(DispatchRequestSchema.safeParse(req).success).toBe(false);
  });

  it("rejects simulator with empty messages array", () => {
    const req = {
      operation: "simulator",
      payload: {
        session_id: SESSION_ID,
        agent_id: AGENT_ID,
        messages: [], // must have at least 1
      },
    };
    expect(DispatchRequestSchema.safeParse(req).success).toBe(false);
  });
});

// ─── AgentManifestSchema ──────────────────────────────────────────────────────

describe("AgentManifestSchema", () => {
  const valid = {
    agent_id: AGENT_ID,
    name: "Alignment Agent v1",
    version: "1.0.0",
    description: "Primary alignment evaluation agent.",
    capabilities: [
      {
        name: "evaluate_alignment",
        description: "Scores alignment of agent outputs",
        input_schema: { prompt: "string" },
        output_schema: { score: "number", status: "string" },
      },
    ],
    models: {
      primary: "gemini-1.5-pro-latest",
      fallback: "gemini-1.5-flash-latest",
      embedding: "text-embedding-004",
    },
    embedding_dim: 768,
    max_context_tokens: 128000,
    rate_limits: { requests_per_minute: 60, tokens_per_day: 1000000 },
    created_at: NOW,
    updated_at: NOW,
  };

  it("accepts a valid agent manifest", () => {
    expect(AgentManifestSchema.safeParse(valid).success).toBe(true);
  });

  it("defaults embedding_dim to 768", () => {
    const { embedding_dim, ...without } = valid;
    const result = AgentManifestSchema.safeParse(without);
    expect(result.success && result.data.embedding_dim).toBe(768);
  });

  it("rejects invalid semver version string", () => {
    expect(AgentManifestSchema.safeParse({ ...valid, version: "v1.0" }).success).toBe(false);
  });

  it("rejects empty capabilities array", () => {
    expect(AgentManifestSchema.safeParse({ ...valid, capabilities: [] }).success).toBe(false);
  });
});

// ─── WebhookEventSchema ───────────────────────────────────────────────────────

describe("WebhookEventSchema", () => {
  const valid = {
    event_id: SESSION_ID,
    event_type: "agent.run.completed",
    idempotency_key: "idem-key-abc-123",
    occurred_at: NOW,
    data: { run_id: "run-1", agent_id: AGENT_ID },
  };

  it("accepts a valid webhook event", () => {
    expect(WebhookEventSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects unknown event_type", () => {
    expect(
      WebhookEventSchema.safeParse({ ...valid, event_type: "unknown.event" }).success
    ).toBe(false);
  });

  it("accepts all defined event types", () => {
    const types = [
      "agent.run.completed",
      "agent.run.failed",
      "loop.message.created",
      "design.baseline.updated",
      "billing.usage.threshold",
    ];
    for (const event_type of types) {
      expect(WebhookEventSchema.safeParse({ ...valid, event_type }).success).toBe(true);
    }
  });
});
