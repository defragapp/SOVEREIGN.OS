// frontend/src/hooks/useCompression.ts
// Hook for the Compression space (Pro) — calls Worker, exposes queuing on 5xx.

import { useState, useCallback, useRef } from "react";
import { workerDispatch, friendlyError } from "@lib/worker-client";

export interface CompressionInput {
  content: string;
  mode?: "distill" | "reframe" | "crystallise";
  outputFormat?: "prose" | "bullets" | "structured";
  preserveVoice?: boolean;
}

export interface CompressionResult {
  compressed: string;
  word_count_original: number;
  word_count_compressed: number;
  compression_ratio: number;
  mode: string;
  generated_at: string;
}

export type CompressionStatus =
  | "idle"
  | "loading"
  | "success"
  | "error"
  | "rate_limited"
  | "upgrade_required"
  | "queued"; // optimistic retry state

const QUEUE_DELAY_MS = 3_000;

export interface UseCompressionReturn {
  status: CompressionStatus;
  result: CompressionResult | null;
  errorMessage: string | null;
  run: (input: CompressionInput, userId: string, idempotencyKey?: string) => Promise<void>;
  retry: () => void;
  reset: () => void;
}

export function useCompression(): UseCompressionReturn {
  const [status, setStatus] = useState<CompressionStatus>("idle");
  const [result, setResult] = useState<CompressionResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const queueRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Store last call args for retry
  const lastCallRef = useRef<{
    input: CompressionInput;
    userId: string;
    idempotencyKey?: string;
  } | null>(null);

  const execute = useCallback(
    async (input: CompressionInput, userId: string, idempotencyKey?: string) => {
      abortRef.current?.abort();
      if (queueRef.current) clearTimeout(queueRef.current);
      abortRef.current = new AbortController();
      lastCallRef.current = { input, userId, idempotencyKey };

      setStatus("loading");
      setResult(null);
      setErrorMessage(null);

      const response = await workerDispatch<CompressionResult>({
        space: "compression",
        userId,
        payload: {
          content: input.content,
          mode: input.mode ?? "distill",
          output_format: input.outputFormat ?? "prose",
          preserve_voice: input.preserveVoice ?? true,
        },
        idempotencyKey,
        signal: abortRef.current.signal,
      });

      if (response.ok) {
        setResult(response.data);
        setStatus("success");
        return;
      }

      const { error, status: httpStatus } = response;

      if (httpStatus === 403) {
        setStatus("upgrade_required");
        setErrorMessage("Compression is available on the Pro plan. Upgrade to unlock it.");
        return;
      }

      if (httpStatus === 429) {
        setStatus("rate_limited");
        setErrorMessage(error.error);
        return;
      }

      // 5xx — queue a retry
      if (httpStatus >= 500 || httpStatus === 0) {
        setStatus("queued");
        setErrorMessage("Something went wrong. We'll try again in a moment…");
        queueRef.current = setTimeout(() => {
          if (lastCallRef.current) {
            const { input: i, userId: u, idempotencyKey: k } = lastCallRef.current;
            execute(i, u, k).catch(() => {});
          }
        }, QUEUE_DELAY_MS);
        return;
      }

      setStatus("error");
      setErrorMessage(friendlyError(error, httpStatus));
    },
    []
  );

  const retry = useCallback(() => {
    if (lastCallRef.current) {
      const { input, userId, idempotencyKey } = lastCallRef.current;
      execute(input, userId, idempotencyKey).catch(() => {});
    }
  }, [execute]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    if (queueRef.current) clearTimeout(queueRef.current);
    setStatus("idle");
    setResult(null);
    setErrorMessage(null);
    lastCallRef.current = null;
  }, []);

  return { status, result, errorMessage, run: execute, retry, reset };
}
