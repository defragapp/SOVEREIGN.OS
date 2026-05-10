// frontend/src/hooks/useAlignment.ts
// Hook for the Alignment space — calls the Worker, surfaces user-friendly state.

import { useState, useCallback, useRef } from "react";
import { workerDispatch, friendlyError, type WorkerError } from "@lib/worker-client";

export interface AlignmentInput {
  dob: string;
  timeOfBirth?: string;
  timezone?: string;
  question?: string;
  depth?: "brief" | "standard" | "deep";
}

export interface AlignmentResult {
  reading: string;
  archetypes: string[];
  guidance: string;
  themes: string[];
  generated_at: string;
}

export type AlignmentStatus = "idle" | "loading" | "success" | "error" | "rate_limited" | "upgrade_required";

export interface UseAlignmentReturn {
  status: AlignmentStatus;
  result: AlignmentResult | null;
  errorMessage: string | null;
  run: (input: AlignmentInput, userId: string) => Promise<void>;
  reset: () => void;
}

export function useAlignment(): UseAlignmentReturn {
  const [status, setStatus] = useState<AlignmentStatus>("idle");
  const [result, setResult] = useState<AlignmentResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (input: AlignmentInput, userId: string) => {
    // Cancel any in-flight request
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setStatus("loading");
    setResult(null);
    setErrorMessage(null);

    const response = await workerDispatch<AlignmentResult>({
      space: "alignment",
      userId,
      payload: {
        dob: input.dob,
        ...(input.timeOfBirth ? { time_of_birth: input.timeOfBirth } : {}),
        timezone: input.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...(input.question ? { question: input.question } : {}),
        depth: input.depth ?? "standard",
      },
      signal: abortRef.current.signal,
    });

    if (response.ok) {
      setResult(response.data);
      setStatus("success");
    } else {
      const { error, status: httpStatus } = response;
      if (httpStatus === 429) setStatus("rate_limited");
      else if (httpStatus === 403) setStatus("upgrade_required");
      else setStatus("error");
      setErrorMessage(friendlyError(error, httpStatus));
    }
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setStatus("idle");
    setResult(null);
    setErrorMessage(null);
  }, []);

  return { status, result, errorMessage, run, reset };
}
