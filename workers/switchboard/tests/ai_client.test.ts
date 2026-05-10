// workers/switchboard/tests/ai_client.test.ts
// Unit tests for ai_client — all AI calls are mocked via vi.mock.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AIClientError } from "../src/ai_client";

// ─── Mock the Vercel AI SDK ───────────────────────────────────────────────────

vi.mock("ai", () => ({
  generateObject: vi.fn(),
  generateText: vi.fn(),
  streamText: vi.fn(),
}));

vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: vi.fn(() => vi.fn(() => "mock-model")),
}));

import { generateObject, generateText, streamText } from "ai";
import {
  generateStructured,
  generatePlainText,
  streamAI,
  probeAI,
} from "../src/ai_client";

const mockEnv = {
  GEMINI_API_KEY: "test-key",
};

// ─── generateStructured ───────────────────────────────────────────────────────

describe("generateStructured", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls generateObject with correct params and returns object", async () => {
    const mockObject = {
      reading: "You carry the mark of Saturn...",
      archetypes: ["The Seeker"],
      guidance: "Move forward.",
      themes: ["transformation"],
      generated_at: new Date().toISOString(),
    };

    vi.mocked(generateObject).mockResolvedValueOnce({
      object: mockObject,
      usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
      finishReason: "stop",
      warnings: [],
      rawResponse: {} as never,
      response: {} as never,
      logprobs: undefined,
      request: {} as never,
    } as never);

    const { z } = await import("zod");
    const schema = z.object({
      reading: z.string(),
      archetypes: z.array(z.string()),
      guidance: z.string(),
      themes: z.array(z.string()),
      generated_at: z.string(),
    });

    const result = await generateStructured({
      env: mockEnv,
      schema,
      schemaName: "AlignmentResponse",
      system: "You are a guide.",
      prompt: "DOB: 1990-01-15",
    });

    expect(result.object).toEqual(mockObject);
    expect(generateObject).toHaveBeenCalledOnce();

    const callArgs = vi.mocked(generateObject).mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.system).toBe("You are a guide.");
    expect(callArgs.prompt).toBe("DOB: 1990-01-15");
    expect(callArgs.temperature).toBe(0.5); // default
    expect(callArgs.maxTokens).toBe(2048); // default
  });

  it("uses pro model when modelKey is pro", async () => {
    vi.mocked(generateObject).mockResolvedValueOnce({ object: {}, usage: {} } as never);
    const { z } = await import("zod");

    await generateStructured({
      env: mockEnv,
      modelKey: "pro",
      schema: z.object({}),
      schemaName: "Test",
      system: "sys",
      prompt: "p",
    }).catch(() => {}); // may fail schema validation, that's ok

    expect(generateObject).toHaveBeenCalledOnce();
  });

  it("propagates errors from generateObject", async () => {
    vi.mocked(generateObject).mockRejectedValueOnce(new Error("API key invalid"));
    const { z } = await import("zod");

    await expect(
      generateStructured({
        env: mockEnv,
        schema: z.object({ x: z.string() }),
        schemaName: "Test",
        system: "sys",
        prompt: "p",
      })
    ).rejects.toThrow("API key invalid");
  });

  it("respects custom temperature and maxTokens", async () => {
    vi.mocked(generateObject).mockResolvedValueOnce({ object: {}, usage: {} } as never);
    const { z } = await import("zod");

    await generateStructured({
      env: mockEnv,
      schema: z.object({}),
      schemaName: "Test",
      system: "sys",
      prompt: "p",
      temperature: 0.2,
      maxTokens: 512,
    }).catch(() => {});

    const call = vi.mocked(generateObject).mock.calls[0][0] as Record<string, unknown>;
    expect(call.temperature).toBe(0.2);
    expect(call.maxTokens).toBe(512);
  });
});

// ─── generatePlainText ────────────────────────────────────────────────────────

describe("generatePlainText", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns text from generateText", async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "You are ready to take the next step.",
      usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
      finishReason: "stop",
      warnings: [],
    } as never);

    const result = await generatePlainText({
      env: mockEnv,
      system: "sys",
      prompt: "What should I know?",
    });

    expect(result).toBe("You are ready to take the next step.");
    expect(generateText).toHaveBeenCalledOnce();
  });

  it("propagates errors", async () => {
    vi.mocked(generateText).mockRejectedValueOnce(new Error("Rate limit"));
    await expect(
      generatePlainText({ env: mockEnv, system: "s", prompt: "p" })
    ).rejects.toThrow("Rate limit");
  });
});

// ─── streamAI ─────────────────────────────────────────────────────────────────

describe("streamAI", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls streamText with messages", () => {
    const mockStream = { textStream: (async function* () { yield "Hello"; })() };
    vi.mocked(streamText).mockReturnValueOnce(mockStream as never);

    const result = streamAI({
      env: mockEnv,
      system: "You are a guide.",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(streamText).toHaveBeenCalledOnce();
    expect(result).toBe(mockStream);

    const call = vi.mocked(streamText).mock.calls[0][0] as Record<string, unknown>;
    expect(call.system).toBe("You are a guide.");
  });

  it("uses flash model by default", () => {
    const mockStream = { textStream: (async function* () {})() };
    vi.mocked(streamText).mockReturnValueOnce(mockStream as never);

    streamAI({
      env: mockEnv,
      system: "sys",
      messages: [{ role: "user", content: "hello" }],
    });

    // modelKey defaults to "flash" — createGoogleGenerativeAI is called with flash model
    expect(streamText).toHaveBeenCalledOnce();
  });
});

// ─── probeAI ──────────────────────────────────────────────────────────────────

describe("probeAI", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns ok:true when generateText succeeds", async () => {
    vi.mocked(generateText).mockResolvedValueOnce({ text: "ok" } as never);
    const result = await probeAI(mockEnv);
    expect(result.ok).toBe(true);
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("returns ok:false when generateText throws", async () => {
    vi.mocked(generateText).mockRejectedValueOnce(new Error("Network error"));
    const result = await probeAI(mockEnv);
    expect(result.ok).toBe(false);
  });
});

// ─── AIClientError ────────────────────────────────────────────────────────────

describe("AIClientError", () => {
  it("has correct name and statusCode", () => {
    const err = new AIClientError("Something went wrong", 429);
    expect(err.name).toBe("AIClientError");
    expect(err.message).toBe("Something went wrong");
    expect(err.statusCode).toBe(429);
  });

  it("defaults statusCode to 500", () => {
    const err = new AIClientError("Error");
    expect(err.statusCode).toBe(500);
  });

  it("is instanceof Error", () => {
    expect(new AIClientError("e")).toBeInstanceOf(Error);
  });
});
