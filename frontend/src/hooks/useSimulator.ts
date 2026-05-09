/**
 * useSimulator.ts
 * React hook for the streaming Loop Simulator.
 * Replaces /api/simulator — calls the Worker's /dispatch simulator operation.
 */

import { useState, useCallback, useRef } from "react";
import { dispatchStream, WorkerUnavailableError } from "../lib/worker-client";
import { nanoid } from "nanoid";

export interface SimulatorMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export type SimulatorState =
  | { status: "idle" }
  | { status: "streaming"; content: string; tokenCount: number }
  | { status: "success"; content: string; tokenCount: number }
  | { status: "queued"; queueId: string; message: string }
  | { status: "error"; code: string; message: string; retryable: boolean };

export interface UseSimulatorReturn {
  state: SimulatorState;
  simulate: (opts: {
    session_id: string;
    agent_id: string;
    loop_id?: string;
    messages: SimulatorMessage[];
    max_tokens?: number;
    temperature?: number;
  }) => Promise<void>;
  reset: () => void;
  cancel: () => void;
}

export function useSimulator(): UseSimulatorReturn {
  const [state, setState] = useState<SimulatorState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setState({ status: "idle" });
  }, []);

  const reset = useCallback(() => setState({ status: "idle" }), []);

  const simulate = useCallback(async (opts: {
    session_id: string;
    agent_id: string;
    loop_id?: string;
    messages: SimulatorMessage[];
    max_tokens?: number;
    temperature?: number;
  }) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({ status: "streaming", content: "", tokenCount: 0 });

    let accumulated = "";
    let totalTokens = 0;

    try {
      for await (const event of dispatchStream({
        operation: "simulator",
        payload: {
          ...opts,
          max_tokens: opts.max_tokens ?? 2048,
          temperature: opts.temperature ?? 0.7,
        } as unknown as Record<string, unknown>,
        idempotencyKey: nanoid(),
        signal: controller.signal,
      })) {
        if (controller.signal.aborted) break;

        if (event.type === "delta") {
          const data = event.data as { delta?: string };
          accumulated += data.delta ?? "";
          setState({ status: "streaming", content: accumulated, tokenCount: totalTokens });
        } else if (event.type === "usage") {
          const data = event.data as { total_tokens?: number };
          totalTokens = data.total_tokens ?? totalTokens;
        } else if (event.type === "error") {
          const data = event.data as { message?: string };
          setState({
            status: "error",
            code: "STREAM_ERROR",
            message: data.message ?? "Stream error occurred",
            retryable: true,
          });
          return;
        } else if (event.type === "done") {
          break;
        }
      }

      if (!controller.signal.aborted) {
        setState({ status: "success", content: accumulated, tokenCount: totalTokens });
      }
    } catch (err) {
      if (controller.signal.aborted) return;

      if (err instanceof WorkerUnavailableError) {
        setState({
          status: "queued",
          queueId: err.requestId,
          message: "The simulator is temporarily unavailable. Your session has been queued.",
        });
        return;
      }

      setState({
        status: "error",
        code: "STREAM_ERROR",
        message: err instanceof Error ? err.message : "Simulator failed",
        retryable: true,
      });
    }
  }, []);

  return { state, simulate, reset, cancel };
}
