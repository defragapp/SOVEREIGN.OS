/**
 * media/pipeline_runner.ts
 * Story → Storyboard → Video → Storage pipeline.
 * Orchestrates AI Switchboard calls and uploads to S3-compatible storage.
 */

import { createClient } from "@supabase/supabase-js";

const WORKER_URL = process.env.WORKER_URL ?? "https://api.sovereign.os";
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ─── Types ─────────────────────────────────────────────────────────────────────

export type PipelineStage = "story" | "storyboard" | "video" | "storage";

export interface PipelineJob {
  id: string;
  user_id: string;
  session_id: string;
  input: {
    prompt: string;
    style?: "cinematic" | "animated" | "documentary" | "abstract";
    duration_seconds?: number;
    aspect_ratio?: "16:9" | "9:16" | "1:1";
  };
}

export interface PipelineResult {
  job_id: string;
  stage: PipelineStage;
  story?: string;
  storyboard?: StoryboardFrame[];
  video_url?: string;
  storage_key?: string;
  credits_used: number;
  latency_ms: number;
}

export interface StoryboardFrame {
  index: number;
  description: string;
  shot_type: "wide" | "medium" | "close" | "extreme_close";
  duration_seconds: number;
  dialogue?: string;
  action: string;
}

// ─── Stage 1: Story synthesis ──────────────────────────────────────────────────

async function generateStory(job: PipelineJob): Promise<string> {
  const prompt = `
You are SOVEREIGN STORY ARCHITECT. Do not use the word "generate".
Craft a compelling short-form narrative for visual production.

User vision: "${job.input.prompt}"
Style: ${job.input.style ?? "cinematic"}
Duration: ${job.input.duration_seconds ?? 30} seconds

Produce: A vivid, emotionally resonant story outline (3-5 sentences) that will guide visual production.
Include: Opening hook, central tension, visual resolution. Be specific about imagery.
  `.trim();

  const res = await fetch(`${WORKER_URL}/dispatch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      operation: "alignment",
      payload: {
        session_id: job.session_id,
        agent_id: "media-story-agent",
        prompt,
        temperature: 0.8,
        stream: false,
      },
    }),
  });

  if (!res.ok) throw new Error(`Story stage failed: ${res.status}`);
  const data = await res.json() as { reasoning: string };
  return data.reasoning;
}

// ─── Stage 2: Storyboard creation ─────────────────────────────────────────────

async function createStoryboard(
  job: PipelineJob,
  story: string
): Promise<StoryboardFrame[]> {
  const frameCount = Math.max(3, Math.floor((job.input.duration_seconds ?? 30) / 5));

  const prompt = `
You are SOVEREIGN STORYBOARD DIRECTOR. Do not use the word "generate".
Break the following story into ${frameCount} visual frames for a ${job.input.aspect_ratio ?? "16:9"} composition.

STORY: ${story}

For each frame return a JSON array with fields:
index (0-based), description (visual composition), shot_type (wide|medium|close|extreme_close),
duration_seconds (float), action (what happens), dialogue (optional string).

Return ONLY the JSON array, no markdown.
  `.trim();

  const res = await fetch(`${WORKER_URL}/dispatch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      operation: "compression",
      payload: {
        session_id: job.session_id,
        content: prompt,
        target_ratio: 0.95,
        format: "structured_json",
      },
    }),
  });

  if (!res.ok) throw new Error(`Storyboard stage failed: ${res.status}`);
  const data = await res.json() as { compressed_content: string };

  try {
    return JSON.parse(data.compressed_content) as StoryboardFrame[];
  } catch {
    // Fallback: return a single placeholder frame
    return [{
      index: 0,
      description: story.slice(0, 120),
      shot_type: "wide",
      duration_seconds: job.input.duration_seconds ?? 30,
      action: "Visual flow of the narrative",
    }];
  }
}

// ─── Stage 3: Video URL (stub — integrate Replicate/Runway/Kling) ──────────────

async function renderVideo(
  job: PipelineJob,
  frames: StoryboardFrame[]
): Promise<string> {
  // TODO: integrate with video generation API (Replicate, Runway ML, Kling)
  // For now returns a placeholder signed URL pattern
  const jobKey = `media/${job.user_id}/${job.id}/output.mp4`;

  // In production: POST to video API, poll for completion, store result URL
  console.log(`[media] Video render queued: ${jobKey} — ${frames.length} frames`);

  // Return the expected storage URL (pre-signed in production)
  const storageUrl = `${SUPABASE_URL}/storage/v1/object/public/media/${jobKey}`;
  return storageUrl;
}

// ─── Stage 4: Storage + DB record ─────────────────────────────────────────────

async function persistJobResult(
  job: PipelineJob,
  result: {
    story: string;
    frames: StoryboardFrame[];
    videoUrl: string;
    creditsUsed: number;
  }
): Promise<string> {
  const storageKey = `media/${job.user_id}/${job.id}/output.mp4`;

  await supabase.from("media_jobs").update({
    status: "completed",
    output_url: result.videoUrl,
    storage_key: storageKey,
    credits_used: result.creditsUsed,
    completed_at: new Date().toISOString(),
    input_data: {
      ...job.input,
      story: result.story,
      storyboard: result.frames,
    },
  }).eq("id", job.id);

  // Deduct credits
  await supabase.rpc("deduct_credits", {
    p_user_id: job.user_id,
    p_amount: result.creditsUsed,
    p_operation: "media",
    p_reference_id: job.id,
    p_idempotency_key: `media-${job.id}`,
  });

  return storageKey;
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export async function runMediaPipeline(job: PipelineJob): Promise<PipelineResult> {
  const t0 = Date.now();
  let creditsUsed = 0;

  // Create DB record
  await supabase.from("media_jobs").insert({
    id: job.id,
    user_id: job.user_id,
    session_id: job.session_id,
    type: "video",
    status: "processing",
    input_data: job.input,
    created_at: new Date().toISOString(),
  });

  try {
    // Stage 1
    const story = await generateStory(job);
    creditsUsed += 2;

    // Stage 2
    const frames = await createStoryboard(job, story);
    creditsUsed += 3;

    // Stage 3
    const videoUrl = await renderVideo(job, frames);
    creditsUsed += 10;

    // Stage 4
    const storageKey = await persistJobResult(job, { story, frames, videoUrl, creditsUsed });

    return {
      job_id: job.id,
      stage: "storage",
      story,
      storyboard: frames,
      video_url: videoUrl,
      storage_key: storageKey,
      credits_used: creditsUsed,
      latency_ms: Date.now() - t0,
    };
  } catch (err) {
    await supabase.from("media_jobs").update({
      status: "failed",
      error_message: err instanceof Error ? err.message : "Unknown error",
      completed_at: new Date().toISOString(),
    }).eq("id", job.id);
    throw err;
  }
}
