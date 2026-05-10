// workers/switchboard/src/stream_helpers.ts
// Converts Vercel AI SDK streams → standard Web API Response streams.
// Also provides SSE formatting and timeout wrappers for edge compute.

import type { StreamTextResult } from "ai";

// ─── SSE helpers ─────────────────────────────────────────────────────────────

export function sseEvent(data: string, event?: string, id?: string): string {
  let msg = "";
  if (id) msg += `id: ${id}\n`;
  if (event) msg += `event: ${event}\n`;
  msg += `data: ${data}\n\n`;
  return msg;
}

export function sseDone(): string {
  return `data: [DONE]\n\n`;
}

// ─── SDK stream → Response (SSE) ─────────────────────────────────────────────

/**
 * Pipes a Vercel AI SDK streamText result into an SSE Response.
 * Each text delta is emitted as a `data: <chunk>` SSE event.
 * Terminates with `data: [DONE]`.
 */
export function sdkStreamToSse(
  result: StreamTextResult<Record<string, never>, string>,
  opts: { timeoutMs?: number } = {}
): Response {
  const { timeoutMs = 55_000 } = opts; // stay under CF's 60s wall clock
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const timeoutId = setTimeout(() => {
        controller.enqueue(
          encoder.encode(sseEvent(JSON.stringify({ error: "stream_timeout" }), "error"))
        );
        controller.enqueue(encoder.encode(sseDone()));
        controller.close();
      }, timeoutMs);

      try {
        for await (const chunk of result.textStream) {
          if (chunk) {
            controller.enqueue(encoder.encode(sseEvent(JSON.stringify({ text: chunk }))));
          }
        }

        // Emit final usage if available
        const usage = await result.usage.catch(() => null);
        if (usage) {
          controller.enqueue(
            encoder.encode(sseEvent(JSON.stringify({ usage }), "meta"))
          );
        }

        controller.enqueue(encoder.encode(sseDone()));
      } catch (err) {
        const message = err instanceof Error ? err.message : "stream_error";
        controller.enqueue(
          encoder.encode(sseEvent(JSON.stringify({ error: message }), "error"))
        );
        controller.enqueue(encoder.encode(sseDone()));
      } finally {
        clearTimeout(timeoutId);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}

// ─── Raw ReadableStream → Response (SSE passthrough) ─────────────────────────

/**
 * Passes a raw ReadableStream (e.g. from Foundry) directly to the client as SSE.
 * Useful when Foundry returns an SSE stream that we forward unchanged.
 */
export function rawStreamToResponse(
  stream: ReadableStream<Uint8Array>,
  opts: { timeoutMs?: number } = {}
): Response {
  const { timeoutMs = 55_000 } = opts;
  const encoder = new TextEncoder();

  const timedStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = stream.getReader();
      const timeoutId = setTimeout(() => {
        reader.cancel();
        controller.enqueue(encoder.encode(sseDone()));
        controller.close();
      }, timeoutMs);

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
        controller.enqueue(encoder.encode(sseDone()));
      } catch {
        controller.enqueue(encoder.encode(sseDone()));
      } finally {
        clearTimeout(timeoutId);
        controller.close();
        reader.releaseLock();
      }
    },
  });

  return new Response(timedStream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

// ─── JSON stream (NDJSON) ─────────────────────────────────────────────────────

/**
 * Streams newline-delimited JSON (NDJSON) records.
 * Each record is a JSON object on its own line, terminated by a sentinel.
 */
export function ndjsonStream(
  asyncIter: AsyncIterable<Record<string, unknown>>
): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const record of asyncIter) {
          controller.enqueue(encoder.encode(JSON.stringify(record) + "\n"));
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
      "Transfer-Encoding": "chunked",
    },
  });
}

// ─── Utility: collect stream to string ────────────────────────────────────────

export async function collectStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  result += decoder.decode(); // flush
  return result;
}
