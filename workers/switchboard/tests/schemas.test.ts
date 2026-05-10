// workers/switchboard/tests/schemas.test.ts
// Unit tests for all Zod schemas — no network calls.

import { describe, it, expect } from "vitest";
import {
  AlignmentRequestSchema,
  AlignmentResponseSchema,
  CompressionRequestSchema,
  CompressionResponseSchema,
  DefragRequestSchema,
  LoopRequestSchema,
  AgentManifestSchema,
  WebhookEventSchema,
  DispatchRequestSchema,
  SpaceSchema,
} from "../src/schemas";

// ─── Space enum ───────────────────────────────────────────────────────────────

describe("SpaceSchema", () => {
  it("accepts all valid spaces", () => {
    const spaces = ["launcher", "defrag", "alignment", "the_loop", "compression", "covenant"];
    for (const s of spaces) {
      expect(SpaceSchema.parse(s)).toBe(s);
    }
  });

  it("rejects unknown space", () => {
    expect(() => SpaceSchema.parse("unknown_space")).toThrow();
  });
});

// ─── Dispatch envelope ────────────────────────────────────────────────────────

describe("DispatchRequestSchema", () => {
  const base = {
    space: "alignment",
    user_id: "550e8400-e29b-41d4-a716-446655440000",
    payload: { dob: "1993-07-15", depth: "standard" },
  };

  it("accepts valid envelope", () => {
    const result = DispatchRequestSchema.parse(base);
    expect(result.space).toBe("alignment");
    expect(result.user_id).toBe(base.user_id);
  });

  it("rejects non-UUID user_id", () => {
    expect(() => DispatchRequestSchema.parse({ ...base, user_id: "not-a-uuid" })).toThrow();
  });

  it("accepts optional idempotency_key", () => {
    const result = DispatchRequestSchema.parse({ ...base, idempotency_key: "idem-123" });
    expect(result.idempotency_key).toBe("idem-123");
  });

  it("rejects idempotency_key over 128 chars", () => {
    expect(() =>
      DispatchRequestSchema.parse({ ...base, idempotency_key: "x".repeat(129) })
    ).toThrow();
  });
});

// ─── Alignment ────────────────────────────────────────────────────────────────

describe("AlignmentRequestSchema", () => {
  it("accepts minimal valid payload", () => {
    const result = AlignmentRequestSchema.parse({ dob: "1990-01-15" });
    expect(result.dob).toBe("1990-01-15");
    expect(result.depth).toBe("standard"); // default
    expect(result.timezone).toBe("UTC"); // default
  });

  it("rejects invalid dob format", () => {
    expect(() => AlignmentRequestSchema.parse({ dob: "01/15/1990" })).toThrow();
    expect(() => AlignmentRequestSchema.parse({ dob: "1990-1-5" })).toThrow();
  });

  it("rejects invalid time_of_birth", () => {
    expect(() =>
      AlignmentRequestSchema.parse({ dob: "1990-01-15", time_of_birth: "9:30am" })
    ).toThrow();
  });

  it("accepts valid time_of_birth", () => {
    const result = AlignmentRequestSchema.parse({
      dob: "1990-01-15",
      time_of_birth: "09:30",
    });
    expect(result.time_of_birth).toBe("09:30");
  });

  it("rejects question over 1200 chars", () => {
    expect(() =>
      AlignmentRequestSchema.parse({ dob: "1990-01-15", question: "q".repeat(1201) })
    ).toThrow();
  });

  it("accepts all depth values", () => {
    for (const d of ["brief", "standard", "deep"]) {
      const r = AlignmentRequestSchema.parse({ dob: "1990-01-15", depth: d });
      expect(r.depth).toBe(d);
    }
  });
});

describe("AlignmentResponseSchema", () => {
  it("validates a well-formed response", () => {
    const r = AlignmentResponseSchema.parse({
      reading: "You carry the weight of Saturn...",
      archetypes: ["The Seeker", "The Hermit"],
      guidance: "Move forward with quiet confidence.",
      themes: ["transformation", "solitude"],
      generated_at: "2026-05-09T17:00:00.000Z",
    });
    expect(r.archetypes).toHaveLength(2);
  });

  it("rejects archetypes over 5", () => {
    expect(() =>
      AlignmentResponseSchema.parse({
        reading: "...",
        archetypes: ["a", "b", "c", "d", "e", "f"],
        guidance: "...",
        themes: [],
        generated_at: new Date().toISOString(),
      })
    ).toThrow();
  });
});

// ─── Compression ──────────────────────────────────────────────────────────────

describe("CompressionRequestSchema", () => {
  const longContent = "This is a meaningful thought. ".repeat(5); // ~150 chars

  it("accepts valid payload", () => {
    const r = CompressionRequestSchema.parse({
      content: longContent,
      mode: "distill",
      output_format: "prose",
    });
    expect(r.preserve_voice).toBe(true); // default
  });

  it("rejects content under 20 chars", () => {
    expect(() => CompressionRequestSchema.parse({ content: "Too short" })).toThrow();
  });

  it("rejects content over 40000 chars", () => {
    expect(() =>
      CompressionRequestSchema.parse({ content: "x".repeat(40_001) })
    ).toThrow();
  });

  it("accepts all modes", () => {
    for (const mode of ["distill", "reframe", "crystallise"]) {
      const r = CompressionRequestSchema.parse({ content: longContent, mode });
      expect(r.mode).toBe(mode);
    }
  });
});

describe("CompressionResponseSchema", () => {
  it("validates a well-formed response", () => {
    const r = CompressionResponseSchema.parse({
      compressed: "A distilled truth.",
      word_count_original: 150,
      word_count_compressed: 3,
      compression_ratio: 0.98,
      mode: "distill",
      generated_at: new Date().toISOString(),
    });
    expect(r.compression_ratio).toBe(0.98);
  });

  it("rejects compression_ratio outside 0-1", () => {
    expect(() =>
      CompressionResponseSchema.parse({
        compressed: "...",
        word_count_original: 100,
        word_count_compressed: 10,
        compression_ratio: 1.5,
        mode: "distill",
        generated_at: new Date().toISOString(),
      })
    ).toThrow();
  });
});

// ─── Defrag ───────────────────────────────────────────────────────────────────

describe("DefragRequestSchema", () => {
  const entry = { id: "e1", text: "I keep thinking about changing careers." };

  it("accepts minimal valid payload", () => {
    const r = DefragRequestSchema.parse({ entries: [entry] });
    expect(r.entries).toHaveLength(1);
    expect(r.output_format).toBe("clusters"); // default
  });

  it("rejects empty entries array", () => {
    expect(() => DefragRequestSchema.parse({ entries: [] })).toThrow();
  });

  it("rejects more than 50 entries", () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ id: `e${i}`, text: "thought" }));
    expect(() => DefragRequestSchema.parse({ entries: many })).toThrow();
  });

  it("rejects entry text over 4000 chars", () => {
    expect(() =>
      DefragRequestSchema.parse({ entries: [{ id: "e1", text: "x".repeat(4001) }] })
    ).toThrow();
  });
});

// ─── The Loop ─────────────────────────────────────────────────────────────────

describe("LoopRequestSchema", () => {
  const base = {
    agent_id: "550e8400-e29b-41d4-a716-446655440001",
    message: "What should I focus on today?",
  };

  it("accepts valid payload", () => {
    const r = LoopRequestSchema.parse(base);
    expect(r.stream).toBe(true); // default
    expect(r.embed).toBe(false); // default
  });

  it("rejects non-UUID agent_id", () => {
    expect(() => LoopRequestSchema.parse({ ...base, agent_id: "not-uuid" })).toThrow();
  });

  it("rejects empty message", () => {
    expect(() => LoopRequestSchema.parse({ ...base, message: "" })).toThrow();
  });

  it("rejects message over 8000 chars", () => {
    expect(() =>
      LoopRequestSchema.parse({ ...base, message: "x".repeat(8001) })
    ).toThrow();
  });
});

// ─── Agent manifest ───────────────────────────────────────────────────────────

describe("AgentManifestSchema", () => {
  const valid = {
    id: "550e8400-e29b-41d4-a716-446655440002",
    name: "Alignment Guide",
    version: "1.0.0",
    capabilities: ["alignment"],
    system_prompt: "You are a guide...",
    model_preference: "gemini-1.5-flash",
  };

  it("accepts valid manifest", () => {
    const r = AgentManifestSchema.parse(valid);
    expect(r.temperature).toBe(0.7); // default
    expect(r.max_tokens).toBe(1024); // default
  });

  it("rejects invalid semver", () => {
    expect(() => AgentManifestSchema.parse({ ...valid, version: "1.0" })).toThrow();
  });

  it("rejects empty capabilities", () => {
    expect(() => AgentManifestSchema.parse({ ...valid, capabilities: [] })).toThrow();
  });

  it("rejects temperature > 2", () => {
    expect(() => AgentManifestSchema.parse({ ...valid, temperature: 2.5 })).toThrow();
  });

  it("rejects max_tokens < 64", () => {
    expect(() => AgentManifestSchema.parse({ ...valid, max_tokens: 32 })).toThrow();
  });

  it("rejects system_prompt over 8000 chars", () => {
    expect(() =>
      AgentManifestSchema.parse({ ...valid, system_prompt: "x".repeat(8001) })
    ).toThrow();
  });
});

// ─── Webhook events ───────────────────────────────────────────────────────────

describe("WebhookEventSchema", () => {
  it("accepts checkout.session.completed", () => {
    const r = WebhookEventSchema.parse({
      type: "stripe.checkout.session.completed",
      idempotency_key: "idem-456",
      data: {
        user_id: "550e8400-e29b-41d4-a716-446655440000",
        plan: "pro",
        stripe_customer_id: "cus_test",
        stripe_subscription_id: "sub_test",
      },
    });
    expect(r.type).toBe("stripe.checkout.session.completed");
  });

  it("accepts subscription.deleted", () => {
    const r = WebhookEventSchema.parse({
      type: "stripe.customer.subscription.deleted",
      idempotency_key: "idem-789",
      data: {
        user_id: "550e8400-e29b-41d4-a716-446655440000",
        stripe_subscription_id: "sub_test",
      },
    });
    expect(r.type).toBe("stripe.customer.subscription.deleted");
  });

  it("rejects unknown event type", () => {
    expect(() =>
      WebhookEventSchema.parse({ type: "stripe.unknown", idempotency_key: "x", data: {} })
    ).toThrow();
  });

  it("rejects invalid plan tier", () => {
    expect(() =>
      WebhookEventSchema.parse({
        type: "stripe.checkout.session.completed",
        idempotency_key: "x",
        data: {
          user_id: "550e8400-e29b-41d4-a716-446655440000",
          plan: "enterprise", // invalid
          stripe_customer_id: "cus_x",
          stripe_subscription_id: "sub_x",
        },
      })
    ).toThrow();
  });
});
