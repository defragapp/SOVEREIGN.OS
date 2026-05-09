/**
 * stream_helpers.ts
 * Converts Vercel AI SDK streams into standard Cloudflare Workers Response streams.
 * Supports both SSE (text/event-stream) and raw NDJSON chunked responses.
 */

import type { StreamTextResult, CoreMessage } from "ai";

// ─── SSE helpers ──────────────────────────────────────────────────────────────

/**
 * Formats a data payload as a Server-Sent Events chunk.
 */
function sseChunk(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function sseDone(): string {
  return `event: done\ndata: [DONE]\n\n`;
}

// ─── SDK stream → SSE Response ────────────────────────────────────────────────

/**
 * Converts a Vercel AI SDK `streamText` result into a Cloudflare Workers
 * `Response` with `Content-Type: text/event-stream`.
 *
 * Each text delta is emitted as:
 *   event: delta
 *   data: {"delta": "...chunk...", "session_id": "..."}
 *
 * When the stream ends, usage stats are emitted:
 *   event: usage
 *   data: {"prompt_tokens": N, "completion_tokens": N, "total_tokens": N}
 *
 *   event: done
 *   data: [DONE]
 */
export function sdkStreamToSSE(
  result: StreamTextResult<Record<string, unknown>, unknown>,
  sessionId: string,
  headers: Record<string, string> = {}
): Response {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // Kick off async pump — do NOT await here so the Response is returned immediately.
  (async () => {
    try {
      for await (const delta of result.textStream) {
        const chunk = sseChunk("delta", { delta, session_id: sessionId });
        await writer.write(encoder.encode(chunk));
      }

      // Emit usage after stream completes
      const usage = await result.usage;
      if (usage) {
        await writer.write(
          encoder.encode(
            sseChunk("usage", {
              prompt_tokens: usage.promptTokens,
              completion_tokens: usage.completionTokens,
              total_tokens: usage.totalTokens,
            })
          )
        );
      }

      await writer.write(encoder.encode(sseDone()));
      await writer.close();
    } catch (err) {
      const errChunk = sseChunk("error", {
        message: err instanceof Error ? err.message : "Stream error",
      });
      await writer.write(encoder.encode(errChunk));
      await writer.close();
    }
  })();

  return new Response(readable, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*", // tightened per-route via CORS middleware
      ...headers,
    },
  });
}

// ─── SDK stream → NDJSON Response ────────────────────────────────────────────

/**
 * Converts an SDK stream result to newline-delimited JSON chunks.
 * Compatible with the Vercel AI SDK `useChat` hook's `streamProtocol: "text"`.
 */
export function sdkStreamToNDJSON(
  result: StreamTextResult<Record<string, unknown>, unknown>,
  sessionId: string,
  headers: Record<string, string> = {}
): Response {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  (async () => {
    try {
      for await (const delta of result.textStream) {
        const line = JSON.stringify({ type: "text", text: delta, session_id: sessionId });
        await writer.write(encoder.encode(line + "\n"));
      }

      const usage = await result.usage;
      if (usage) {
        const line = JSON.stringify({
          type: "finish",
          usage: {
            prompt_tokens: usage.promptTokens,
            completion_tokens: usage.completionTokens,
            total_tokens: usage.totalTokens,
          },
        });
        await writer.write(encoder.encode(line + "\n"));
      }

      await writer.close();
    } catch (err) {
      const line = JSON.stringify({
        type: "error",
        error: err instanceof Error ? err.message : "Stream error",
      });
      await writer.write(encoder.encode(line + "\n"));
      await writer.close();
    }
  })();

  return new Response(readable, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
      "Transfer-Encoding": "chunked",
      ...headers,
    },
  });
}

// ─── Timeout wrapper ──────────────────────────────────────────────────────────

/**
 * Wraps a streaming Response with an AbortController timeout.
 * If the stream does not complete within `timeoutMs`, the controller is aborted
 * and a 504 JSON error is returned instead.
 *
 * NOTE: Cloudflare Workers have a hard CPU-time limit. Use this to enforce
 * application-level streaming timeouts well within that boundary.
 */
export async function withStreamTimeout(
  streamFn: (signal: AbortSignal) => Promise<Response>,
  timeoutMs = 25_000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await streamFn(controller.signal);
    clearTimeout(timer);
    return response;
  } catch (err) {
    clearTimeout(timer);
    if (controller.signal.aborted) {
      return new Response(
        JSON.stringify({
          error: {
            code: "STREAM_TIMEOUT",
            message: `Stream exceeded ${timeoutMs}ms limit`,
            retryable: true,
          },
        }),
        {
          status: 504,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
    throw err;
  }
}

// ─── Request size guard ───────────────────────────────────────────────────────

/**
 * Reads and validates the request body size.
 * Returns the parsed JSON or throws with a 413 payload.
 */
export async function readBodyWithLimit(
  request: Request,
  maxBytes = 512_000
): Promise<unknown> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > maxBytes) {
    throw Object.assign(
      new Error(`Request body exceeds ${maxBytes} byte limit`),
      { status: 413, code: "PAYLOAD_TOO_LARGE" }
    );
  }

  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > maxBytes) {
    throw Object.assign(
      new Error(`Request body exceeds ${maxBytes} byte limit`),
      { status: 413, code: "PAYLOAD_TOO_LARGE" }
    );
  }

  const text = new TextDecoder().decode(buffer);
  return JSON.parse(text);
}
