/**
 * index.ts — SOVEREIGN.OS Switchboard Worker (v0.5.0)
 * Hono v4 on Cloudflare Workers
 * AI layer: Cloudflare Workers AI binding (env.AI) — no Gemini key required
 *
 * Includes PR #4 patches:
 *  [HIGH] Idempotency: return actual response_json (not {cached: true})
 *  [HIGH] waitUntil: Loop Supabase writes survive stream close
 *  [MED]  Webhook: 64KB payload size guard before HMAC check
 */

import { Hono }                    from 'hono';
import { cors }                    from 'hono/cors';
import { streamSSE }               from 'hono/streaming';
import { z }                       from 'zod';
import { createClient }            from '@supabase/supabase-js';
import {
  generateObject,
  streamText,
  generateEmbedding,
  selectModel,
  CF_MODEL_FAST,
  CF_MODEL_STANDARD,
  type AiEnv,
  type AiMessage,
} from './ai_client';
import {
  DispatchSchema,
  LauncherResponseSchema,
  DefragResponseSchema,
  AlignmentResponseSchema,
  CompressionResponseSchema,
  CovenantResponseSchema,
  SimulatorResponseSchema,
} from './schemas';

// ── Environment bindings ──────────────────────────────────────────────────────
export type Env = AiEnv & {
  // AI: AiBinding  ← inherited from AiEnv, bound via [ai] in wrangler.toml
  SUPABASE_URL:              string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  WORKER_HMAC_SECRET:        string;
  FOUNDRY_API_URL?:          string;
  FOUNDRY_API_KEY?:          string;
};

type Vars = { userId: string };

// ── App ───────────────────────────────────────────────────────────────────────
const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use('*', cors({
  origin:         ['https://sovereign.os', 'https://www.sovereign.os', 'http://localhost:3000'],
  allowMethods:   ['GET', 'POST', 'OPTIONS'],
  allowHeaders:   ['Content-Type', 'Authorization', 'X-Idempotency-Key'],
  credentials:    true,
  exposeHeaders:  ['X-Request-Id'],
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
function sb(env: Env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

async function checkRateLimit(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  space: string,
  maxPerDay: number,
): Promise<boolean> {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const { count } = await supabase
    .from('agent_runs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('space', space)
    .gte('created_at', since.toISOString());
  return (count ?? 0) < maxPerDay;
}

async function getUserTier(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<'free' | 'pro'> {
  const { data } = await supabase
    .from('profiles')
    .select('tier')
    .eq('id', userId)
    .single();
  return (data?.tier as 'free' | 'pro') ?? 'free';
}

async function logRun(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  space: string,
  prompt: string,
  responseJson: unknown,
  tokensUsed: number,
  durationMs: number,
  idempotencyKey?: string,
): Promise<string> {
  const { data } = await supabase
    .from('agent_runs')
    .insert({
      user_id:         userId,
      space,
      prompt:          prompt.slice(0, 4096),
      response_json:   responseJson,
      tokens_used:     tokensUsed,
      duration_ms:     durationMs,
      idempotency_key: idempotencyKey ?? null,
    })
    .select('id')
    .single();
  return data?.id ?? '';
}

// ── Auth middleware ───────────────────────────────────────────────────────────
app.use('/dispatch', async (c, next) => {
  const auth = c.req.header('Authorization');
  if (!auth?.startsWith('Bearer ')) return c.json({ error: 'unauthorized' }, 401);
  const token = auth.slice(7);
  const supabase = sb(c.env);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return c.json({ error: 'unauthorized' }, 401);
  c.set('userId', user.id);
  await next();
});

// ── GET /health ───────────────────────────────────────────────────────────────
app.get('/health', async (c) => {
  const start = Date.now();
  const supabase = sb(c.env);

  // DB check
  const { error: dbErr } = await supabase.from('profiles').select('id').limit(1);

  // AI binding check — tiny call to confirm binding works
  let aiStatus: 'ok' | 'degraded' = 'ok';
  try {
    await c.env.AI.run(CF_MODEL_FAST, {
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 1,
    });
  } catch {
    aiStatus = 'degraded';
  }

  const healthy = !dbErr && aiStatus === 'ok';
  return c.json(
    {
      status:    healthy ? 'healthy' : 'degraded',
      checks:    { supabase: dbErr ? 'error' : 'ok', ai: aiStatus },
      version:   '0.5.0',
      ai_models: { standard: CF_MODEL_STANDARD, fast: CF_MODEL_FAST },
      latency_ms: Date.now() - start,
      timestamp:  new Date().toISOString(),
    },
    healthy ? 200 : 503,
  );
});

// ── POST /webhook ─────────────────────────────────────────────────────────────
app.post('/webhook', async (c) => {
  // [PR #4 PATCH — MED] 64KB payload guard before HMAC check
  const contentLength = parseInt(c.req.header('content-length') ?? '0', 10);
  if (contentLength > 65_536) return c.json({ error: 'payload_too_large' }, 413);

  const rawBody = await c.req.text();
  if (rawBody.length > 65_536) return c.json({ error: 'payload_too_large' }, 413);

  const signature = c.req.header('stripe-signature');
  if (!signature) return c.json({ error: 'missing_signature' }, 400);

  // HMAC-SHA256 verification (Stripe format: t=...,v1=...)
  try {
    const parts   = Object.fromEntries(signature.split(',').map((p) => p.split('=')));
    const ts      = parts['t'];
    const v1      = parts['v1'];
    if (!ts || !v1) return c.json({ error: 'invalid_signature_format' }, 400);

    const signedPayload = `${ts}.${rawBody}`;
    const key   = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(c.env.WORKER_HMAC_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig   = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
    const hex   = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
    if (hex !== v1) return c.json({ error: 'signature_mismatch' }, 401);

    const event   = JSON.parse(rawBody);
    const supabase = sb(c.env);

    // Idempotent event storage
    const { error: insertErr } = await supabase.from('webhook_events').insert({
      stripe_event_id: event.id,
      event_type:      event.type,
      payload:         event,
      processed_at:    new Date().toISOString(),
    });
    if (insertErr && !insertErr.message.includes('duplicate')) {
      console.error('webhook insert error:', insertErr.message);
    }

    // Handle billing lifecycle
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      await supabase.from('profiles').update({
        tier:                   'pro',
        stripe_customer_id:     session.customer,
        stripe_subscription_id: session.subscription,
      }).eq('id', session.client_reference_id);
      await supabase.from('credits_ledger').insert({
        user_id: session.client_reference_id,
        delta:   100,
        reason:  'pro_subscription_activated',
      });
    }
    if (event.type === 'customer.subscription.deleted') {
      await supabase.from('profiles').update({ tier: 'free' })
        .eq('stripe_subscription_id', event.data.object.id);
    }
    if (event.type === 'invoice.payment_failed') {
      const inv = event.data.object;
      await supabase.from('audit_log').insert({
        action:  'payment_failed',
        payload: { customer: inv.customer, amount_due: inv.amount_due },
      });
    }

    return c.json({ received: true });
  } catch (err) {
    console.error('webhook error:', err);
    return c.json({ error: 'webhook_processing_failed' }, 500);
  }
});

// ── POST /dispatch ────────────────────────────────────────────────────────────
app.post('/dispatch', async (c) => {
  const userId = c.get('userId');
  const body   = await c.req.json().catch(() => null);
  if (!body)   return c.json({ error: 'invalid_json' }, 400);

  const parsed = DispatchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  }

  const { space, prompt, options = {} } = parsed.data;
  const idempotencyKey = c.req.header('X-Idempotency-Key') ?? body.idempotency_key;
  const supabase = sb(c.env);

  // [PR #4 PATCH — HIGH] Idempotency: return actual response_json, not {cached: true}
  if (idempotencyKey) {
    const { data: cached } = await supabase
      .from('agent_runs')
      .select('response_json')
      .eq('user_id', userId)
      .eq('space', space)
      .eq('idempotency_key', idempotencyKey)
      .not('response_json', 'is', null)
      .single();
    if (cached?.response_json) {
      return c.json({ ...cached.response_json, _cached: true });
    }
  }

  // Route
  switch (space) {
    case 'launcher':    return handleLauncher(c, userId, prompt, options, supabase, idempotencyKey);
    case 'defrag':      return handleDefrag(c, userId, prompt, options, supabase, idempotencyKey);
    case 'alignment':   return handleAlignment(c, userId, prompt, options, supabase, idempotencyKey);
    case 'the_loop':    return handleTheLoop(c, userId, prompt, options, supabase, idempotencyKey);
    case 'compression': return handleCompression(c, userId, prompt, options, supabase, idempotencyKey);
    case 'covenant':    return handleCovenant(c, userId, prompt, options, supabase, idempotencyKey);
    case 'simulator':   return handleSimulator(c, userId, prompt, options, supabase, idempotencyKey);
    default: return c.json({ error: 'unknown_space' }, 400);
  }
});

// ── Space handlers ────────────────────────────────────────────────────────────

/** LAUNCHER — Suggest which space to use (3B model, fast) */
async function handleLauncher(c: any, userId: string, prompt: string, _opts: any, supabase: any, iKey?: string) {
  const t0  = Date.now();
  const msgs: AiMessage[] = [
    {
      role: 'system',
      content:
        'You are the SOVEREIGN.OS Launcher. Given the user\'s intent, decide which space they need. ' +
        'Spaces: defrag (brain dump/clarity), alignment (values/purpose), the_loop (ongoing conversation), ' +
        'compression (summarise/distil), covenant (commitments/promises), simulator (explore decisions). ' +
        'Return JSON: { "space": "<name>", "confidence": 0-1, "reasoning": "<one sentence>" }',
    },
    { role: 'user', content: prompt },
  ];
  const result = await generateObject(c.env, {
    model:             CF_MODEL_FAST,
    messages:          msgs,
    schema:            LauncherResponseSchema,
    schemaDescription: '{ "space": string, "confidence": number, "reasoning": string }',
  });
  const runId = await logRun(supabase, userId, 'launcher', prompt, result, 0, Date.now() - t0, iKey);
  return c.json({ ...result, run_id: runId });
}

/** DEFRAG — Brain dump → clarity (3B, rate-limited 3/day) */
async function handleDefrag(c: any, userId: string, prompt: string, _opts: any, supabase: any, iKey?: string) {
  const ok = await checkRateLimit(supabase, userId, 'defrag', 3);
  if (!ok) return c.json({ error: 'rate_limit_exceeded', space: 'defrag', limit: 3, period: 'day' }, 429);

  const t0  = Date.now();
  const msgs: AiMessage[] = [
    {
      role: 'system',
      content:
        'You are the Defrag space in SOVEREIGN.OS — a mental clarity engine. ' +
        'The user is dumping raw thoughts. Extract structure and return: ' +
        '{ "themes": [string], "tensions": [string], "clarity_statement": string, "next_action": string }',
    },
    { role: 'user', content: prompt },
  ];
  const result = await generateObject(c.env, {
    model:             CF_MODEL_FAST,
    messages:          msgs,
    schema:            DefragResponseSchema,
    schemaDescription: '{ "themes": string[], "tensions": string[], "clarity_statement": string, "next_action": string }',
  });
  const runId = await logRun(supabase, userId, 'defrag', prompt, result, 0, Date.now() - t0, iKey);
  return c.json({ ...result, run_id: runId });
}

/** ALIGNMENT — Values/purpose work (8B deep or 3B standard, rate-limited 5/day) */
async function handleAlignment(c: any, userId: string, prompt: string, opts: any, supabase: any, iKey?: string) {
  const ok = await checkRateLimit(supabase, userId, 'alignment', 5);
  if (!ok) return c.json({ error: 'rate_limit_exceeded', space: 'alignment', limit: 5, period: 'day' }, 429);

  const depth = opts?.depth === 'deep' ? 'deep' : 'standard';
  const model = selectModel('alignment', depth);
  const t0    = Date.now();

  const msgs: AiMessage[] = [
    {
      role: 'system',
      content:
        'You are the Alignment space in SOVEREIGN.OS — a values and purpose clarifier. ' +
        'Guide the user to understand what matters most. ' +
        'Return: { "values_identified": [string], "alignment_score": 0-10, ' +
        '"misalignments": [string], "purpose_statement": string, "recommended_actions": [string] }',
    },
    { role: 'user', content: prompt },
  ];
  const result = await generateObject(c.env, {
    model,
    messages:          msgs,
    schema:            AlignmentResponseSchema,
    schemaDescription: '{ "values_identified": string[], "alignment_score": number, "misalignments": string[], "purpose_statement": string, "recommended_actions": string[] }',
  });
  const runId = await logRun(supabase, userId, 'alignment', prompt, result, 0, Date.now() - t0, iKey);
  return c.json({ ...result, depth, run_id: runId });
}

/** THE LOOP — Streaming multi-turn agent (8B, SSE, rate-limited 3/day) */
async function handleTheLoop(c: any, userId: string, prompt: string, opts: any, supabase: any, iKey?: string) {
  const ok = await checkRateLimit(supabase, userId, 'the_loop', 3);
  if (!ok) return c.json({ error: 'rate_limit_exceeded', space: 'the_loop', limit: 3, period: 'day' }, 429);

  const history: AiMessage[] = opts?.history ?? [];
  const msgs: AiMessage[] = [
    {
      role: 'system',
      content:
        'You are The Loop in SOVEREIGN.OS — a thoughtful, ongoing AI companion. ' +
        'Engage deeply with the user\'s situation. Be concise, insightful, and action-oriented.',
    },
    ...history,
    { role: 'user', content: prompt },
  ];

  const t0 = Date.now();

  return streamSSE(c, async (stream) => {
    let fullText = '';
    try {
      const cfStream = await streamText(c.env, { model: CF_MODEL_STANDARD, messages: msgs });
      const reader   = cfStream.getReader();
      const decoder  = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        // CF Workers AI streams as: data: {"response":"token"}\n\n
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') break;
          try {
            const parsed = JSON.parse(raw);
            const token  = parsed?.response ?? '';
            if (token) {
              fullText += token;
              await stream.writeSSE({ data: JSON.stringify({ token }) });
            }
          } catch { /* skip malformed chunk */ }
        }
      }

      await stream.writeSSE({ data: JSON.stringify({ done: true }) });
    } finally {
      // [PR #4 PATCH — HIGH] waitUntil: persist run after stream closes
      c.executionCtx.waitUntil(
        logRun(supabase, userId, 'the_loop', prompt, { response: fullText }, 0, Date.now() - t0, iKey)
          .then((runId) =>
            supabase.from('loop_messages').insert([
              { user_id: userId, role: 'user',      content: prompt,    run_id: runId },
              { user_id: userId, role: 'assistant', content: fullText, run_id: runId },
            ]),
          )
          .catch((e) => console.error('loop persist error:', e)),
      );
    }
  });
}

/** COMPRESSION — Summarise/distil content (3B, pro = unlimited, free = 5/day) */
async function handleCompression(c: any, userId: string, prompt: string, opts: any, supabase: any, iKey?: string) {
  const tier = await getUserTier(supabase, userId);
  if (tier === 'free') {
    const ok = await checkRateLimit(supabase, userId, 'compression', 5);
    if (!ok) return c.json({ error: 'rate_limit_exceeded', space: 'compression', limit: 5, period: 'day', upgrade: true }, 429);
  }

  const style = opts?.style ?? 'bullets'; // 'bullets' | 'prose' | 'tldr'
  const t0    = Date.now();

  const msgs: AiMessage[] = [
    {
      role: 'system',
      content:
        `You are the Compression space in SOVEREIGN.OS — a signal-extraction engine. ` +
        `Distil the user's input to its essential core in "${style}" style. ` +
        `Return: { "summary": string, "key_points": [string], "signal_strength": 0-10, "discarded_noise": [string] }`,
    },
    { role: 'user', content: prompt },
  ];
  const result = await generateObject(c.env, {
    model:             CF_MODEL_FAST,
    messages:          msgs,
    schema:            CompressionResponseSchema,
    schemaDescription: '{ "summary": string, "key_points": string[], "signal_strength": number, "discarded_noise": string[] }',
  });

  // Optional: generate embedding for compressed output
  if (opts?.embed) {
    try {
      const vec = await generateEmbedding(c.env, result.summary);
      await supabase.from('embeddings').insert({
        user_id:  userId,
        content:  result.summary,
        embedding: vec,
        metadata: { space: 'compression', source_length: prompt.length },
      });
    } catch (e) { console.warn('embedding failed:', e); }
  }

  const runId = await logRun(supabase, userId, 'compression', prompt, result, 0, Date.now() - t0, iKey);
  return c.json({ ...result, run_id: runId });
}

/** COVENANT — Commitments and promises (8B, pro tier only) */
async function handleCovenant(c: any, userId: string, prompt: string, _opts: any, supabase: any, iKey?: string) {
  const tier = await getUserTier(supabase, userId);
  if (tier !== 'pro') {
    return c.json({ error: 'pro_required', space: 'covenant', message: 'Covenant requires a Pro subscription.' }, 403);
  }

  const t0 = Date.now();
  const msgs: AiMessage[] = [
    {
      role: 'system',
      content:
        'You are the Covenant space in SOVEREIGN.OS — a sacred commitment engine. ' +
        'Help the user crystallise meaningful commitments and promises to themselves. ' +
        'Be honest about difficulty. Return: ' +
        '{ "covenant_statement": string, "commitments": [string], "accountability_triggers": [string], ' +
        '"risk_of_breaking": string, "renewal_date": "YYYY-MM-DD" }',
    },
    { role: 'user', content: prompt },
  ];
  const result = await generateObject(c.env, {
    model:             CF_MODEL_STANDARD,
    messages:          msgs,
    schema:            CovenantResponseSchema,
    schemaDescription: '{ "covenant_statement": string, "commitments": string[], "accountability_triggers": string[], "risk_of_breaking": string, "renewal_date": string }',
  });
  const runId = await logRun(supabase, userId, 'covenant', prompt, result, 0, Date.now() - t0, iKey);
  return c.json({ ...result, run_id: runId });
}

/** SIMULATOR — Explore decisions through scenarios (3B, all tiers) */
async function handleSimulator(c: any, userId: string, prompt: string, opts: any, supabase: any, iKey?: string) {
  const t0       = Date.now();
  const numPaths = Math.min(opts?.paths ?? 3, 5);

  const msgs: AiMessage[] = [
    {
      role: 'system',
      content:
        `You are the Simulator space in SOVEREIGN.OS — a decision-exploration engine. ` +
        `Generate ${numPaths} distinct future paths for the user's situation. ` +
        `Return: { "decision_context": string, "paths": [{ "title": string, "probability": 0-1, ` +
        `"description": string, "upsides": [string], "downsides": [string], "first_step": string }], ` +
        `"recommended_path": string }`,
    },
    { role: 'user', content: prompt },
  ];
  const result = await generateObject(c.env, {
    model:             CF_MODEL_FAST,
    messages:          msgs,
    schema:            SimulatorResponseSchema,
    schemaDescription: `{ "decision_context": string, "paths": Array<{title,probability,description,upsides,downsides,first_step}>, "recommended_path": string }`,
  });
  const runId = await logRun(supabase, userId, 'simulator', prompt, result, 0, Date.now() - t0, iKey);
  return c.json({ ...result, run_id: runId });
}

// ── 404 ───────────────────────────────────────────────────────────────────────
app.notFound((c) => c.json({ error: 'not_found' }, 404));
app.onError((err, c) => {
  console.error('unhandled error:', err);
  return c.json({ error: 'internal_server_error', message: err.message }, 500);
});

export default app;
