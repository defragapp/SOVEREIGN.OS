// workers/switchboard/src/ai_client.ts
// Vercel AI SDK wrappers for Google Gemini — edge-compatible.
// Provides typed helpers for structured JSON generation and streaming text.

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  generateObject,
  generateText,
  streamText,
  type CoreMessage,
  type GenerateObjectResult,
  type StreamTextResult,
} from "ai";
import type { ZodSchema } from "zod";

export interface AIEnv {
  GEMINI_API_KEY: string;
}

// ─── Model identifiers ────────────────────────────────────────────────────────

export const MODELS = {
  /** High-quality reasoning — alignment, covenant */
  pro: "gemini-1.5-pro",
  /** Low-latency — defrag, loop, compression */
  flash: "gemini-1.5-flash",
} as const;

export type ModelKey = keyof typeof MODELS;

// ─── Client factory ───────────────────────────────────────────────────────────

let _google: ReturnType<typeof createGoogleGenerativeAI> | null = null;

function getGoogle(env: AIEnv) {
  if (!_google) {
    _google = createGoogleGenerativeAI({ apiKey: env.GEMINI_API_KEY });
  }
  return _google;
}

function resolveModel(env: AIEnv, modelKey: ModelKey) {
  const google = getGoogle(env);
  return google(MODELS[modelKey]);
}

// ─── Structured JSON generation ────────────────────────────────────────────

/** Generate a strongly-typed JSON object validated against a Zod schema. */
export async function generateStructured<T>(opts: {
  env: AIEnv;
  modelKey?: ModelKey;
  schema: ZodSchema<T>;
  schemaName: string;
  system: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  abortSignal?: AbortSignal;
}): Promise<GenerateObjectResult<T>> {
  const {
    env,
    modelKey = "pro",
    schema,
    schemaName,
    system,
    prompt,
    temperature = 0.5,
    maxTokens = 2048,
    abortSignal,
  } = opts;

  return generateObject<T>({
    model: resolveModel(env, modelKey),
    schema,
    schemaName,
    system,
    prompt,
    temperature,
    maxTokens,
    abortSignal,
  });
}

// ─── Streaming text ────────────────────────────────────────────────────────

/** Stream a text response — used for The Loop and coaching flows. */
export function streamAI(opts: {
  env: AIEnv;
  modelKey?: ModelKey;
  system: string;
  messages: CoreMessage[];
  temperature?: number;
  maxTokens?: number;
  abortSignal?: AbortSignal;
}): StreamTextResult<Record<string, never>, string> {
  const {
    env,
    modelKey = "flash",
    system,
    messages,
    temperature = 0.7,
    maxTokens = 2048,
    abortSignal,
  } = opts;

  return streamText({
    model: resolveModel(env, modelKey),
    system,
    messages,
    temperature,
    maxTokens,
    abortSignal,
  });
}

// ─── Plain text (non-streaming) ────────────────────────────────────────────

export async function generatePlainText(opts: {
  env: AIEnv;
  modelKey?: ModelKey;
  system: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const {
    env,
    modelKey = "flash",
    system,
    prompt,
    temperature = 0.6,
    maxTokens = 1024,
    abortSignal,
  } = opts;

  const result = await generateText({
    model: resolveModel(env, modelKey),
    system,
    prompt,
    temperature,
    maxTokens,
    abortSignal,
  });

  return result.text;
}

// ─── Embeddings (768-dim Google) ──────────────────────────────────────────

/** Generate a 768-dimensional text embedding using Google's text-embedding-004. */
export async function embedText(
  env: AIEnv,
  text: string,
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" | "SEMANTIC_SIMILARITY" = "RETRIEVAL_DOCUMENT"
): Promise<number[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${env.GEMINI_API_KEY}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "models/text-embedding-004",
      content: { parts: [{ text }] },
      taskType,
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new AIClientError(`Embedding failed ${res.status}: ${err}`, res.status);
  }

  const data = (await res.json()) as { embedding: { values: number[] } };
  return data.embedding.values;
}

// ─── Health probe ─────────────────────────────────────────────────────────

/** Light probe — generates a single token to confirm the API key is live. */
export async function probeAI(env: AIEnv): Promise<{ ok: boolean; latency_ms: number }> {
  const start = Date.now();
  try {
    await generateText({
      model: resolveModel(env, "flash"),
      prompt: "Reply with: ok",
      maxTokens: 4,
    });
    return { ok: true, latency_ms: Date.now() - start };
  } catch {
    return { ok: false, latency_ms: Date.now() - start };
  }
}

// ─── Error class ──────────────────────────────────────────────────────────

export class AIClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500
  ) {
    super(message);
    this.name = "AIClientError";
  }
}
