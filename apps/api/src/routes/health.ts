import { jsonResponse } from "../lib/response";

export function health() {
  return jsonResponse({
    requestId: "health",
    status: "success",
    result: { ok: true, ts: Date.now() },
    traceId: crypto.randomUUID()
  });
}