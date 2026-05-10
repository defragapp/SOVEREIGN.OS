// frontend/src/hooks/useSimulator.ts
// Hook for The Loop — streaming agent conversations via Worker SSE.

import { useState, useCallback, useRef } from "react";
import { workerStream, friendlyError, type WorkerError } from "@lib/worker-client";

export interface SimulatorMessage {
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export type SimulatorStatus =
  | "idle"
  | "streaming"
  | "success"
  | "error"
  | "rate_limited";

export interface UseSimulatorReturn {
  status: SimulatorStatus;
  messages: SimulatorMessage[];
  streamingContent: string;
  errorMessage: string | null;
  conversationId: string | null;
  send: (opts: {
    agentId: string;
    message: string;
    userId: string;
    conversationId?: string;
  }) => Promise<void>;
  reset: () => void;
}

export function useSimulator(): UseSimulatorReturn {
  const [status, setStatus] = useState<SimulatorStatus>("idle");
  const [messages, setMessages] = useState<SimulatorMessage[]>([]);
  const [streamingContent, setStreamingContent] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (opts: {
      agentId: string;
      message: string;
      userId: string;
      conversationId?: string;
    }) => {
      const { agentId, message, userId, conversationId: existingConvId } = opts;

      // Cancel any in-flight stream
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      // Append user message immediately (optimistic)
      const userMessage: SimulatorMessage = {
        role: "user",
        content: message,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMessage]);
      setStreamingContent("");
      setErrorMessage(null);
      setStatus("streaming");

      let assembled = "";

      try {
        await workerStream(
          {
            space: "the_loop",
            userId,
            payload: {
              agent_id: agentId,
              message,
              ...(existingConvId ? { conversation_id: existingConvId } : {}),
              stream: true,
            },
            signal: abortRef.current.signal,
          },
          {
            onChunk: (text) => {
              assembled += text;
              setStreamingContent(assembled);
            },
            onDone: () => {
              if (assembled) {
                const assistantMessage: SimulatorMessage = {
                  role: "assistant",
                  content: assembled,
                  created_at: new Date().toISOString(),
                };
                setMessages((prev) => [...prev, assistantMessage]);
              }
              setStreamingContent("");
              setStatus("success");
            },
            onError: (err) => {
              setStreamingContent("");
              setErrorMessage(
                err === "stream_timeout"
                  ? "The response took too long. Please try again."
                  : "Something went wrong. Please try again."
              );
              setStatus("error");
            },
          }
        );
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          // User cancelled — preserve partial content if any
          if (assembled) {
            setMessages((prev) => [
              ...prev,
              { role: "assistant", content: assembled + "…", created_at: new Date().toISOString() },
            ]);
          }
          setStreamingContent("");
          setStatus("idle");
        } else {
          setErrorMessage("We couldn't reach the server. Check your connection and try again.");
          setStatus("error");
        }
      }
    },
    []
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setStatus("idle");
    setMessages([]);
    setStreamingContent("");
    setErrorMessage(null);
    setConversationId(null);
  }, []);

  return {
    status,
    messages,
    streamingContent,
    errorMessage,
    conversationId,
    send,
    reset,
  };
}
