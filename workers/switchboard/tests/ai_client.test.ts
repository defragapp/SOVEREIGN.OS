/**
 * ai_client.test.ts — Unit tests for AI client wrappers (fully mocked)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock @ai-sdk/google ──────────────────────────────────────────────────────

vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: vi.fn(() => {
    const modelFn = vi.fn((modelId: string) => ({ modelId }));
    modelFn.textEmbeddingModel = vi.fn((modelId: string, opts: Record<string, unknown>) => ({
      modelId,
      outputDimensionality: opts?.outputDimensionality ?? 768,
    }));
    return modelFn;
  }),
}));

// ─── Mock ai SDK functions ────────────────────────────────────────────────────

vi.mock("ai", () => ({
  generateObject: vi.fn(),
  generateText: vi.fn(),
  streamText: vi.fn(),
  embed: vi.fn(),
  embedMany: vi.fn(),
}));

import { generateObject, generateText, streamText, embed, embedMany } from "ai";
import { runAlignment, runCompression, runSimulatorStream, embedTexts, probeAI } from "../src/ai_client";

const FAKE_API_KEY = "test-gemini-key-abc123";

// ─── runAlignment ─────────────────────────────────────────────────────────────

describe("runAlignment", () => {
  beforeEach(() => {
    vi.mocked(generateObject).mockResolvedValue({
      object: {
        status: "aligned",
        score: 0.92,
        reasoning: "The agent decision follows all alignment criteria.",
        recommendations: [],
      },
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      finishReason: "stop",
      rawCall: { rawPrompt: "", rawSettings: {} },
      warnings: [],
      request: {} as Request,
      response: {} as Response,
      logprobs: undefined,
      providerMetadata: undefined,
      experimental_providerMetadata: undefined,
      toJsonResponse: vi.fn(),
    } as never);
  });

  afterEach(() => vi.clearAllMocks());

  it("returns structured alignment result with correct shape", async () => {
    const result = await runAlignment(FAKE_API_KEY, "Evaluate this decision", [], 0.3);

    expect(result.status).toBe("aligned");
    expect(result.score).toBe(0.92);
    expect(result.reasoning).toBeTypeOf("string");
    expect(result.recommendations).toBeInstanceOf(Array);
    expect(result.usage.total_tokens).toBe(150);
    expect(result.model).toContain("gemini");
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("calls generateObject exactly once", async () => {
    await runAlignment(FAKE_API_KEY, "Test prompt", ["ctx1"], 0.5);
    expect(generateObject).toHaveBeenCalledTimes(1);
  });

  it("passes context window in messages", async () => {
    await runAlignment(FAKE_API_KEY, "Test prompt", ["ctx1", "ctx2"], 0.3);
    const call = vi.mocked(generateObject).mock.calls[0][0];
    const userMessage = (call.messages as Array<{ role: string; content: string }>).find(
      (m) => m.role === "user"
    );
    expect(userMessage?.content).toContain("ctx1");
    expect(userMessage?.content).toContain("ctx2");
  });

  it("propagates AI SDK errors", async () => {
    vi.mocked(generateObject).mockRejectedValue(new Error("Rate limit exceeded"));
    await expect(
      runAlignment(FAKE_API_KEY, "Test", [], 0.3)
    ).rejects.toThrow("Rate limit exceeded");
  });
});

// ─── runCompression ───────────────────────────────────────────────────────────

describe("runCompression", () => {
  const CONTENT = "This is a long document. ".repeat(100);

  afterEach(() => vi.clearAllMocks());

  it("uses generateObject for structured_json format", async () => {
    vi.mocked(generateObject).mockResolvedValue({
      object: { compressed_content: "Short summary." },
      usage: { promptTokens: 200, completionTokens: 10, totalTokens: 210 },
      finishReason: "stop",
      rawCall: { rawPrompt: "", rawSettings: {} },
      warnings: [],
      request: {} as Request,
      response: {} as Response,
      logprobs: undefined,
      providerMetadata: undefined,
      experimental_providerMetadata: undefined,
      toJsonResponse: vi.fn(),
    } as never);

    const result = await runCompression(FAKE_API_KEY, CONTENT, 0.1, [], "structured_json");

    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(generateText).not.toHaveBeenCalled();
    expect(result.compressed_content).toBe("Short summary.");
    expect(result.usage.total_tokens).toBe(210);
  });

  it("uses generateText for summary format", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "Condensed version.",
      usage: { promptTokens: 200, completionTokens: 5, totalTokens: 205 },
      finishReason: "stop",
      rawCall: { rawPrompt: "", rawSettings: {} },
      warnings: [],
      request: {} as Request,
      response: {} as Response,
      steps: [],
      toolCalls: [],
      toolResults: [],
      reasoning: undefined,
      reasoningDetails: [],
      sources: [],
      files: [],
      logprobs: undefined,
      providerMetadata: undefined,
      experimental_providerMetadata: undefined,
    } as never);

    const result = await runCompression(FAKE_API_KEY, CONTENT, 0.25, [], "summary");

    expect(generateText).toHaveBeenCalledTimes(1);
    expect(generateObject).not.toHaveBeenCalled();
    expect(result.compressed_content).toBe("Condensed version.");
  });

  it("uses generateText for bullet_points format", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "• Point 1\n• Point 2",
      usage: { promptTokens: 180, completionTokens: 8, totalTokens: 188 },
      finishReason: "stop",
      rawCall: { rawPrompt: "", rawSettings: {} },
      warnings: [],
      request: {} as Request,
      response: {} as Response,
      steps: [],
      toolCalls: [],
      toolResults: [],
      reasoning: undefined,
      reasoningDetails: [],
      sources: [],
      files: [],
      logprobs: undefined,
      providerMetadata: undefined,
      experimental_providerMetadata: undefined,
    } as never);

    const result = await runCompression(FAKE_API_KEY, CONTENT, 0.2, ["key-term"], "bullet_points");
    expect(result.compressed_content).toContain("Point 1");
  });

  it("passes preserve_keys to system prompt", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "summary",
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      finishReason: "stop",
      rawCall: { rawPrompt: "", rawSettings: {} },
      warnings: [],
      request: {} as Request,
      response: {} as Response,
      steps: [],
      toolCalls: [],
      toolResults: [],
      reasoning: undefined,
      reasoningDetails: [],
      sources: [],
      files: [],
      logprobs: undefined,
      providerMetadata: undefined,
      experimental_providerMetadata: undefined,
    } as never);

    await runCompression(FAKE_API_KEY, CONTENT, 0.25, ["important-term"], "summary");
    const call = vi.mocked(generateText).mock.calls[0][0];
    const systemMsg = (call.messages as Array<{ role: string; content: string }>).find(
      (m) => m.role === "system"
    );
    expect(systemMsg?.content).toContain("important-term");
  });
});

// ─── embedTexts ───────────────────────────────────────────────────────────────

describe("embedTexts", () => {
  afterEach(() => vi.clearAllMocks());

  it("uses embed() for a single text and returns 768-dim vector", async () => {
    const fakeEmbedding = Array.from({ length: 768 }, () => Math.random());
    vi.mocked(embed).mockResolvedValue({
      embedding: fakeEmbedding,
      usage: { tokens: 5 },
      rawCall: { rawPrompt: "", rawSettings: {} },
      request: {} as Request,
      response: {} as Response,
      warnings: [],
      providerMetadata: undefined,
      experimental_providerMetadata: undefined,
    } as never);

    const result = await embedTexts(FAKE_API_KEY, ["hello world"]);

    expect(embed).toHaveBeenCalledTimes(1);
    expect(embedMany).not.toHaveBeenCalled();
    expect(result.embeddings).toHaveLength(1);
    expect(result.embeddings[0]).toHaveLength(768);
    expect(result.dim).toBe(768);
  });

  it("uses embedMany() for multiple texts", async () => {
    const fakeEmbeddings = [
      Array.from({ length: 768 }, () => Math.random()),
      Array.from({ length: 768 }, () => Math.random()),
    ];
    vi.mocked(embedMany).mockResolvedValue({
      embeddings: fakeEmbeddings,
      usage: { tokens: 10 },
      rawCall: { rawPrompt: "", rawSettings: {} },
      request: {} as Request,
      response: {} as Response,
      warnings: [],
      providerMetadata: undefined,
      experimental_providerMetadata: undefined,
    } as never);

    const result = await embedTexts(FAKE_API_KEY, ["text1", "text2"]);

    expect(embedMany).toHaveBeenCalledTimes(1);
    expect(embed).not.toHaveBeenCalled();
    expect(result.embeddings).toHaveLength(2);
    expect(result.dim).toBe(768);
  });
});

// ─── probeAI ─────────────────────────────────────────────────────────────────

describe("probeAI", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns ok=true on successful AI call", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "ok",
      usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 },
      finishReason: "stop",
      rawCall: { rawPrompt: "", rawSettings: {} },
      warnings: [],
      request: {} as Request,
      response: {} as Response,
      steps: [],
      toolCalls: [],
      toolResults: [],
      reasoning: undefined,
      reasoningDetails: [],
      sources: [],
      files: [],
      logprobs: undefined,
      providerMetadata: undefined,
      experimental_providerMetadata: undefined,
    } as never);

    const result = await probeAI(FAKE_API_KEY);
    expect(result.ok).toBe(true);
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("returns ok=false on AI SDK error", async () => {
    vi.mocked(generateText).mockRejectedValue(new Error("API unavailable"));

    const result = await probeAI(FAKE_API_KEY);
    expect(result.ok).toBe(false);
  });
});
