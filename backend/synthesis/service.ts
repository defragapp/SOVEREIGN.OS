/**
 * backend/synthesis/service.ts
 * Multi-source synthesis engine — merges agent outputs, astrology overlays,
 * user context, and loop history into a unified coherent narrative.
 * Calls the AI Switchboard Worker for all LLM operations.
 */

const WORKER_URL = process.env.WORKER_URL ?? "https://api.sovereign.os";

export interface SynthesisInput {
  session_id: string;
  agent_id: string;
  user_id?: string;
  sources: SynthesisSource[];
  target_format: "narrative" | "structured" | "action_plan" | "dashboard_card";
  max_output_tokens?: number;
  temperature?: number;
}

export interface SynthesisSource {
  type: "agent_output" | "astrology" | "loop_context" | "baseline_design" | "user_note" | "external";
  label: string;
  content: string;
  weight?: number; // 0.0–1.0 priority weight
  timestamp?: string;
}

export interface SynthesisResult {
  session_id: string;
  synthesis: string;
  source_count: number;
  dominant_themes: string[];
  confidence: number;
  model: string;
  token_usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  latency_ms: number;
  created_at: string;
}

// ─── Compress sources that exceed context budget ───────────────────────────────

async function compressIfNeeded(content: string, label: string): Promise<string> {
  if (content.length <= 2000) return content;
  const res = await fetch(`${WORKER_URL}/dispatch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      operation: "compression",
      payload: {
        session_id: crypto.randomUUID(),
        content,
        target_ratio: 0.3,
        format: "bullet_points",
        preserve_keys: [label],
      },
    }),
  });
  if (!res.ok) return content.slice(0, 2000) + "…";
  const data = await res.json() as { compressed_content: string };
  return data.compressed_content;
}

// ─── Build synthesis prompt ────────────────────────────────────────────────────

async function buildPrompt(input: SynthesisInput): Promise<string> {
  const sortedSources = [...input.sources].sort((a, b) => (b.weight ?? 0.5) - (a.weight ?? 0.5));

  const sourceBlocks = await Promise.all(
    sortedSources.map(async (s) => {
      const content = await compressIfNeeded(s.content, s.label);
      return `### ${s.label.toUpperCase()} [${s.type}]${s.timestamp ? ` — ${s.timestamp}` : ""}\n${content}`;
    })
  );

  const formatInstructions: Record<SynthesisInput["target_format"], string> = {
    narrative: "Write a flowing, insightful narrative synthesis (3–5 paragraphs). Poetic but grounded.",
    structured: "Return a structured synthesis with: Summary, Key Insights (bullets), Risk Factors, Recommended Actions.",
    action_plan: "Return a prioritised action plan: Top 3 immediate actions, 3 medium-term actions, 1 strategic north star.",
    dashboard_card: "Return a concise dashboard card: 1-sentence headline, 3-bullet highlights, 1 call-to-action. Under 120 words total.",
  };

  return [
    "You are SOVEREIGN SYNTHESISER — an intelligence that weaves disparate signals into unified clarity.",
    "Do not use the word 'generate'. Speak with precision and depth.",
    "",
    `OUTPUT FORMAT: ${formatInstructions[input.target_format]}`,
    "",
    "SOURCES TO SYNTHESISE:",
    ...sourceBlocks,
    "",
    "Produce the synthesis now:",
  ].join("\n");
}

// ─── Main synthesis function ───────────────────────────────────────────────────

export async function runSynthesis(input: SynthesisInput): Promise<SynthesisResult> {
  const t0 = Date.now();
  const prompt = await buildPrompt(input);

  const res = await fetch(`${WORKER_URL}/dispatch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Idempotency-Key": `synthesis-${input.session_id}`,
    },
    body: JSON.stringify({
      operation: "alignment",
      payload: {
        session_id: input.session_id,
        agent_id: input.agent_id,
        prompt,
        temperature: input.temperature ?? 0.6,
        stream: false,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.json() as { error?: { message?: string } };
    throw new Error(`Synthesis failed: ${err.error?.message ?? res.status}`);
  }

  const data = await res.json() as {
    reasoning: string;
    token_usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    score: number;
    model: string;
  };

  // Extract dominant themes (simple keyword extraction)
  const themes = extractThemes(data.reasoning);

  return {
    session_id: input.session_id,
    synthesis: data.reasoning,
    source_count: input.sources.length,
    dominant_themes: themes,
    confidence: data.score,
    model: data.model,
    token_usage: data.token_usage,
    latency_ms: Date.now() - t0,
    created_at: new Date().toISOString(),
  };
}

// ─── Streaming synthesis ──────────────────────────────────────────────────────

export async function* runSynthesisStream(
  input: SynthesisInput
): AsyncGenerator<{ type: string; data: unknown }> {
  const prompt = await buildPrompt(input);

  const res = await fetch(`${WORKER_URL}/dispatch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      operation: "simulator",
      payload: {
        session_id: input.session_id,
        agent_id: input.agent_id,
        messages: [
          { role: "system", content: "You are SOVEREIGN SYNTHESISER. Be poetic but precise." },
          { role: "user", content: prompt },
        ],
        max_tokens: input.max_output_tokens ?? 2048,
        temperature: input.temperature ?? 0.6,
      },
    }),
  });

  if (!res.ok || !res.body) throw new Error("Synthesis stream failed");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("data: ") && line !== "data: [DONE]") {
        try {
          yield { type: "chunk", data: JSON.parse(line.slice(6)) };
        } catch { /* skip */ }
      }
    }
  }
  yield { type: "done", data: null };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractThemes(text: string): string[] {
  const themePatterns = [
    /\b(alignment|alignment score|aligned)\b/gi,
    /\b(creativity|creative expression)\b/gi,
    /\b(transformation|transformative)\b/gi,
    /\b(clarity|clear path)\b/gi,
    /\b(expansion|growth|opportunity)\b/gi,
    /\b(integration|integration of)\b/gi,
    /\b(healing|restoration)\b/gi,
    /\b(leadership|strategic vision)\b/gi,
  ];

  const found: string[] = [];
  for (const pattern of themePatterns) {
    if (pattern.test(text)) {
      found.push(pattern.source.replace(/\\b|\(|\)|\|\/gi|\/gi/g, "").split("|")[0]);
    }
  }
  return [...new Set(found)].slice(0, 5);
}
