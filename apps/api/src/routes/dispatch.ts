import { DispatchSchema } from "@sovereign/contracts";
import { jsonResponse } from "../lib/response";
import { safetyCheck } from "../lib/safety";

export async function dispatch(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = DispatchSchema.safeParse(body);

  if (!parsed.success) {
    return jsonResponse(
      {
        requestId: "invalid",
        status: "error",
        result: { error: "invalid_payload" },
        traceId: crypto.randomUUID()
      },
      400
    );
  }

  const data = parsed.data;

  if (!safetyCheck(data.action)) {
    return jsonResponse(
      {
        requestId: data.requestId ?? "blocked",
        status: "error",
        result: { error: "blocked_by_policy" },
        traceId: crypto.randomUUID()
      },
      403
    );
  }

  return jsonResponse({
    requestId: data.requestId ?? crypto.randomUUID(),
    status: "success",
    result: { message: "ok" },
    traceId: crypto.randomUUID()
  });
}