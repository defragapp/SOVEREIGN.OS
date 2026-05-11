import { ApiResponse } from "@sovereign/contracts";

export function jsonResponse<T>(
  data: ApiResponse<T>,
  status: number = 200
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}