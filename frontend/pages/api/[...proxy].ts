/**
 * pages/api/[...proxy].ts
 * Local-dev compatibility shim — proxies /api/* requests to the Worker
 * when running `vercel dev` concurrently with `wrangler dev`.
 *
 * This file is ONLY active in local development (NODE_ENV !== "production").
 * In production, the frontend calls the Worker directly via worker-client.ts.
 *
 * Setup:
 *   1. Start Worker:  wrangler dev --env staging --local  (default: localhost:8787)
 *   2. Start Next.js: vercel dev  (default: localhost:3000)
 *   3. All /api/* calls are transparently proxied to localhost:8787
 *
 * Environment variable:
 *   LOCAL_WORKER_URL=http://localhost:8787  (set in .env.local)
 */

import type { NextApiRequest, NextApiResponse } from "next";

const LOCAL_WORKER_URL =
  process.env.LOCAL_WORKER_URL ?? "http://localhost:8787";

// Map Next.js /api/* paths to Worker paths
function resolveWorkerPath(slug: string[]): string {
  const joined = slug.join("/");

  // Strip legacy /api prefix if present
  if (joined.startsWith("api/")) {
    return `/${joined.slice(4)}`;
  }

  // Direct route mapping
  const ROUTE_MAP: Record<string, string> = {
    dispatch: "/dispatch",
    health: "/health",
    webhook: "/webhook",
    // Legacy route aliases kept for backwards compatibility
    "alignment/evaluate": "/dispatch",
    "compression/run": "/dispatch",
    "simulator/stream": "/dispatch",
  };

  return ROUTE_MAP[joined] ?? `/${joined}`;
}

// Build a transformed body for legacy routes that used to have dedicated endpoints
async function transformBody(slug: string[], body: unknown): Promise<unknown> {
  const joined = slug.join("/");

  if (joined === "alignment/evaluate") {
    return { operation: "alignment", payload: body };
  }
  if (joined === "compression/run") {
    return { operation: "compression", payload: body };
  }
  if (joined === "simulator/stream") {
    return { operation: "simulator", payload: body };
  }

  return body;
}

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
    externalResolver: true,
  },
};

export default async function workerProxy(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    res.status(404).json({
      error: {
        code: "PROXY_DISABLED",
        message: "Worker proxy shim is disabled in production. Use the Worker URL directly.",
      },
    });
    return;
  }

  const slug = (req.query["proxy"] as string[]) ?? [];
  const workerPath = resolveWorkerPath(slug);
  const workerUrl = `${LOCAL_WORKER_URL}${workerPath}`;

  // Read raw body
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk as ArrayBuffer));
  }
  const rawBody = Buffer.concat(chunks).toString("utf-8");

  let transformedBody = rawBody;
  if (rawBody) {
    try {
      const parsed = JSON.parse(rawBody);
      const transformed = await transformBody(slug, parsed);
      transformedBody = JSON.stringify(transformed);
    } catch {
      // Non-JSON body — pass through as-is
    }
  }

  // Forward headers (strip Next.js internals)
  const forwardHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (
      typeof value === "string" &&
      !["host", "connection", "transfer-encoding"].includes(key.toLowerCase())
    ) {
      forwardHeaders[key] = value;
    }
  }

  console.log(
    `[worker-proxy] ${req.method} /api/${slug.join("/")} → ${workerUrl}`
  );

  try {
    const workerRes = await fetch(workerUrl, {
      method: req.method ?? "GET",
      headers: {
        ...forwardHeaders,
        host: new URL(LOCAL_WORKER_URL).host,
      },
      body: ["GET", "HEAD"].includes(req.method ?? "") ? undefined : transformedBody,
      signal: AbortSignal.timeout(30_000),
      // @ts-expect-error — Node 18+ fetch supports duplex
      duplex: "half",
    });

    // Copy status
    res.status(workerRes.status);

    // Copy response headers
    workerRes.headers.forEach((value, key) => {
      if (!["content-encoding", "transfer-encoding"].includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    // Stream response body
    const contentType = workerRes.headers.get("content-type") ?? "";
    const isStreaming =
      contentType.includes("text/event-stream") ||
      contentType.includes("ndjson");

    if (isStreaming && workerRes.body) {
      const reader = workerRes.body.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          res.write(value);
        }
      } finally {
        reader.cancel();
        res.end();
      }
    } else {
      const body = await workerRes.text();
      res.end(body);
    }
  } catch (err) {
    console.error("[worker-proxy] Error:", err);
    res.status(502).json({
      error: {
        code: "PROXY_ERROR",
        message: `Could not reach local Worker at ${LOCAL_WORKER_URL}. Is wrangler dev running?`,
        details: err instanceof Error ? err.message : String(err),
      },
    });
  }
}
