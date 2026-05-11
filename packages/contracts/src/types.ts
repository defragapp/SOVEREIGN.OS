export interface ApiResponse<T = any> {
  requestId: string;
  status: "success" | "error";
  result: T;
  traceId: string;
}