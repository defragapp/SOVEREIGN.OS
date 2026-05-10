/**
 * ai_client.ts — Cloudflare Workers AI inference layer
 * Replaces Gemini / Vercel AI SDK with native CF Workers AI binding (env.AI)
 * No external API keys required — uses account-bound AI binding
 *
 * Models:
 *   Standard (Pro spaces) : @cf/meta/llama-3.1-8b-instruct-fp8-fast
 *   Fast    (Free spaces)  : @cf/meta/llama-3.2-3b-instruct
 *   Embed                  : @cf/baai/bge-base-en-v1.5  → 768-dim (matches schema)
 *
 * Neuron budget (free tier = 10,000 neurons/day):
 *   llama-3.1-8b  : ~4,119 /M input + ~34,868 /M output  → ~20 standard calls/day
 *   llama-3.2-3b  : ~4,625 /M input + ~30,475 /M output  → ~25 fast calls/day
 */

import { z } from 'zod';

// ── Model identifiers ─────────────────────────────────────────────────────────
export const CF_MODEL_STANDARD = '@cf/meta/llama-3.1-8b-instruct-fp8-fast';
export const CF_MODEL_FAST     = '@cf/meta/llama-3.2-3b-instruct';
export const CF_EMBED_MODEL    = '@cf/baai/bge-base-en-v1.5';

// ── Lightweight Ai binding type (augments Cloudflare's workers-types) ─────────
export interface AiBinding {
  run(model: string, options: Record<string, unknown>): Promise<unknown>;
}

export interface AiEnv {
  AI: AiBinding;
}

// ── Message shape ─────────────────────────────────────────────────────────────
export type AiRole = 'system' | 'user' | 'assistant';
export interface AiMessage {
  role: AiRole;
  content: string;
}

// ── generateObject options ────────────────────────────────────────────────────
export interface GenerateObjectOptions<T extends z.ZodTypeAny> {
  /** CF Workers AI model identifier. Defaults to CF_MODEL_STANDARD. */
  model?: string;
  messages: AiMessage[];
  /** Zod schema — used for validation after JSON extraction. */
  schema: T;
  /**
   * Human-readable description of the JSON shape injected into the system
   * prompt. Defaults to the schema's _def keys. Keep concise.
   */
  schemaDescription?: string;
  max_tokens?: number;
}

// ── streamText options ────────────────────────────────────────────────────────
export interface StreamTextOptions {
  model?: string;
  messages: AiMessage[];
  max_tokens?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Inject a JSON-mode hint into the system message so the model knows exactly
 * what shape to return. Appends to existing system message or prepends a new one.
 */
function injectJsonHint(messages: AiMessage[], schemaDesc: string): AiMessage[] {
  const hint =
    `You must respond with ONLY a valid JSON object matching this schema:\n` +
    `${schemaDesc}\n` +
    `Do not include markdown code fences, explanation, or any text outside the JSON.`;

  const sysIdx = messages.findIndex((m) => m.role === 'system');
  if (sysIdx >= 0) {
    return messages.map((m, i) =>
      i === sysIdx ? { ...m, content: `${m.content}\n\n${hint}` } : m,
    );
  }
  return [{ role: 'system', content: hint }, ...messages];
}

/**
 * Extract a JSON object from a model response that may contain prose or fences.
 * Strategy: strip fences → find outermost { } → parse.
 */
function extractJson(raw: string): unknown {
  // Strip markdown fences (```json ... ``` or ``` ... ```)
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const src = (fenced ? fenced[1] : raw).trim();

  // Find outermost JSON object
  const start = src.indexOf('{');
  const end   = src.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error(`No JSON object found in model response:\n${raw.slice(0, 300)}`);
  }
  return JSON.parse(src.slice(start, end + 1));
}

// ── Core functions ────────────────────────────────────────────────────────────

/**
 * generateObject — structured output via CF Workers AI.
 *
 * Uses `response_format: { type: 'json_object' }` (JSON mode, supported by
 * llama-3.1-8b). Falls back gracefully to prompt-extraction if the model
 * returns prose. Always validates with the provided Zod schema.
 */
export async function generateObject<T extends z.ZodTypeAny>(
  env: AiEnv,
  opts: GenerateObjectOptions<T>,
): Promise<z.infer<T>> {
  const model = opts.model ?? CF_MODEL_STANDARD;
  const max_tokens = opts.max_tokens ?? 2048;

  // Build human-readable schema description from Zod _def or provided hint
  const schemaDesc =
    opts.schemaDescription ??
    (() => {
      try {
        // Attempt to extract field names for a simple hint
        const shape = (opts.schema as z.ZodObject<z.ZodRawShape>)._def?.shape?.();
        if (shape) {
          return (
            '{\n' +
            Object.entries(shape)
              .map(([k, v]) => `  "${k}": ${(v as z.ZodTypeAny)._def?.typeName ?? 'any'}`)
              .join(',\n') +
            '\n}'
          );
        }
      } catch {/* noop */}
      return '(structured JSON object)';
    })();

  const messages = injectJsonHint(opts.messages, schemaDesc);

  const result = (await env.AI.run(model, {
    messages,
    response_format: { type: 'json_object' },
    max_tokens,
  })) as { response: string };

  const raw  = result?.response ?? '';
  const data = extractJson(raw);
  return opts.schema.parse(data);
}

/**
 * streamText — streaming SSE via CF Workers AI.
 *
 * Returns a ReadableStream that emits chunks in CF Workers AI SSE format
 * (`data: {"response":"..."}` lines). Caller passes this directly to
 * stream_helpers.streamSseResponse().
 */
export async function streamText(
  env: AiEnv,
  opts: StreamTextOptions,
): Promise<ReadableStream> {
  const model      = opts.model ?? CF_MODEL_STANDARD;
  const max_tokens = opts.max_tokens ?? 4096;

  const stream = (await env.AI.run(model, {
    messages:   opts.messages,
    stream:     true,
    max_tokens,
  })) as ReadableStream;

  return stream;
}

/**
 * generateEmbedding — 768-dim vector via bge-base-en-v1.5.
 *
 * Matches the `vector(768)` column in the Supabase `embeddings` table.
 * Pass the returned array directly to Supabase's vector column.
 */
export async function generateEmbedding(
  env: AiEnv,
  text: string,
): Promise<number[]> {
  const result = (await env.AI.run(CF_EMBED_MODEL, {
    text: [text],
  })) as { data: number[][] };

  if (!result?.data?.[0]) {
    throw new Error('Embedding model returned no data');
  }
  return result.data[0];
}

/**
 * selectModel — maps (space, depth) → CF Workers AI model identifier.
 *
 * Pro spaces (alignment/deep, covenant, the_loop) → 8B standard model
 * Free spaces (launcher, defrag, compression, simulator) → 3B fast model
 */
export function selectModel(
  space: string,
  depth: 'standard' | 'deep' = 'standard',
): string {
  switch (space) {
    case 'covenant':
      return CF_MODEL_STANDARD;
    case 'alignment':
      return depth === 'deep' ? CF_MODEL_STANDARD : CF_MODEL_FAST;
    case 'the_loop':
      return CF_MODEL_STANDARD; // loop agents need multi-step reasoning
    default:
      // launcher, defrag, compression, simulator
      return CF_MODEL_FAST;
  }
}
