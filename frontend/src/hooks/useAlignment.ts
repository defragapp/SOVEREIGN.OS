/**
 * useAlignment.ts
 * React hook for alignment evaluation against the Sovereign Worker.
 * Replaces the old /api/alignment Next.js route.
 */

import { useState, useCallback, useRef } from "react";
import {
  runAlignment,
  dispatchStream,
  WorkerUnavailableError,
  WorkerRequestError,
  type AlignmentRequest,
  type AlignmentResult,
} from "../lib/worker-client";

export type AlignmentState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "streaming"; partial: string }
  | { status: "success"; result: AlignmentResult }
  | { status: "queued"; queueId: string; message: string }
  | { status: "error"; code: string; message: string; retryable: boolean };

export interface UseAlignmentReturn {
  state: AlignmentState;
  evaluate: (req: AlignmentRequest) => Promise<void>;
  evaluateStream: (req: AlignmentRequest) => Promise<void>;
  reset: () => void;
  cancel: () => void;
}

export function useAlignment(): UseAlignmentReturn {
  const [state, setState] = useState<AlignmentState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setState({ status: "idle" });
  }, []);

  const reset = useCallback(() => {
    setState({ status: "idle" });
  }, []);

  // ─── Non-streaming evaluation ───────────────────────────────────────────────

  const evaluate = useCallback(async (req: AlignmentRequest) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({ status: "loading" });

    try {
      const result = await runAlignment(req);
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
            "The AI service is temporarily unavailable. Your alignment request has been queued and will be retried automatically.",
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

  // ─── Streaming evaluation ───────────────────────────────────────────────────

  const evaluateStream = useCallback(async (req: AlignmentRequest) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({ status: "streaming", partial: "" });

    try {
      let accumulated = "";

      for await (const event of dispatchStream({
        operation: "alignment",
        payload: { ...req, stream: true } as unknown as Record<string, unknown>,
        signal: controller.signal,
      })) {
        if (controller.signal.aborted) break;

        if (event.type === "delta") {
          const delta = (event.data as { delta?: string })?.delta ?? "";
          accumulated += delta;
          setState({ status: "streaming", partial: accumulated });
        } else if (event.type === "error") {
          const errData = event.data as { message?: string };
          setState({
            status: "error",
            code: "STREAM_ERROR",
            message: errData.message ?? "Streaming error occurred",
            retryable: true,
          });
          return;
        } else if (event.type === "done") {
          break;
        }
      }

      // Streaming completed — mark as success with partial as text
      if (!controller.signal.aborted && accumulated) {
        // Build a minimal AlignmentResult from streamed text
        setState({
          status: "success",
          result: {
            session_id: req.session_id,
            agent_id: req.agent_id,
            status: "uncertain", // streaming path doesn't return structured score
            score: 0,
            reasoning: accumulated,
            recommendations: [],
            token_usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            latency_ms: 0,
            model: "gemini-1.5-pro-latest",
            created_at: new Date().toISOString(),
          },
        });
      }
    } catch (err) {
      if (controller.signal.aborted) return;

      if (err instanceof WorkerUnavailableError) {
        setState({
          status: "queued",
          queueId: err.requestId,
          message: "The AI service is temporarily unavailable. Your request has been queued.",
        });
        return;
      }

      setState({
        status: "error",
        code: "STREAM_ERROR",
        message: err instanceof Error ? err.message : "Streaming failed",
        retryable: true,
      });
    }
  }, []);

  return { state, evaluate, evaluateStream, reset, cancel };
}
