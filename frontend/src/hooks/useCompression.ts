/**
 * useCompression.ts
 * React hook for context compression against the Sovereign Worker.
 * Replaces the old /api/compression Next.js route.
 */

import { useState, useCallback, useRef } from "react";
import {
  runCompression,
  WorkerUnavailableError,
  WorkerRequestError,
  type CompressionRequest,
  type CompressionResult,
} from "../lib/worker-client";

export type CompressionState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; result: CompressionResult }
  | { status: "queued"; queueId: string; message: string }
  | { status: "error"; code: string; message: string; retryable: boolean };

export interface UseCompressionReturn {
  state: CompressionState;
  compress: (req: CompressionRequest) => Promise<void>;
  reset: () => void;
  cancel: () => void;
}

export function useCompression(): UseCompressionReturn {
  const [state, setState] = useState<CompressionState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setState({ status: "idle" });
  }, []);

  const reset = useCallback(() => setState({ status: "idle" }), []);

  const compress = useCallback(async (req: CompressionRequest) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({ status: "loading" });

    try {
      const result = await runCompression(req);
      if (!controller.signal.aborted) {
        setState({ status: "success", result });
      }
    } catch (err) {
      if (controller.signal.aborted) return;

      if (err instanceof WorkerUnavailableError) {
        setState({
          status: "queued",
          queueId: err.requestId,
          message:
            "The compression service is temporarily unavailable. Your request has been queued and will be retried automatically.",
        });
        return;
      }

      if (err instanceof WorkerRequestError) {
        setState({
          status: "error",
          code: err.error.code,
          message: err.error.message,
          retryable: err.retryable,
        });
        return;
      }

      setState({
        status: "error",
        code: "NETWORK_ERROR",
        message: "A network error occurred. Please check your connection and try again.",
        retryable: true,
      });
    }
  }, []);

  return { state, compress, reset, cancel };
}
