#!/usr/bin/env node
/**
 * supabase-verify.mjs
 * Verifies Supabase read/write from the Worker's perspective (PostgREST only).
 * Runs test inserts into: baseline_designs, agent_runs, loop_messages
 * Then verifies data can be read back.
 *
 * Usage:
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *   node scripts/supabase-verify.mjs
 */

import { randomUUID } from "crypto";
import { writeFileSync } from "fs";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("❌  SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  process.exit(1);
}

const REST_BASE = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1`;
const NOW = new Date().toISOString();

const results = [];
let passed = 0;
let failed = 0;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function headers(prefer = "return=representation") {
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: prefer,
  };
}

async function postgrest(method, table, body, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${REST_BASE}/${table}${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

async function test(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    const ms = Date.now() - t0;
    console.log(`  ✅  ${name} (${ms}ms)`);
    results.push({ name, status: "passed", latency_ms: ms });
    passed++;
  } catch (err) {
    const ms = Date.now() - t0;
    console.error(`  ❌  ${name} (${ms}ms): ${err.message}`);
    results.push({ name, status: "failed", latency_ms: ms, error: err.message });
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

// ─── Test IDs (cleaned up at end) ────────────────────────────────────────────

const TEST_AGENT_ID = process.env.TEST_AGENT_ID ?? randomUUID();
const TEST_SESSION_ID = randomUUID();
const TEST_LOOP_ID = randomUUID();
const TEST_RUN_ID = randomUUID();
const TEST_DESIGN_ID = randomUUID();
const TEST_MESSAGE_ID = randomUUID();

// ─── Suites ───────────────────────────────────────────────────────────────────

console.log(`\n🗄️  Supabase PostgREST Verification`);
console.log(`   URL: ${SUPABASE_URL}`);
console.log(`   Time: ${NOW}\n`);

// ── 1. Connectivity ───────────────────────────────────────────────────────────

await test("GET /rest/v1/ returns 200 (connectivity probe)", async () => {
  const res = await fetch(`${REST_BASE}/`, {
    method: "HEAD",
    headers: headers(),
    signal: AbortSignal.timeout(10_000),
  });
  assert(res.ok, `Expected 2xx, got ${res.status}`);
});

// ── 2. agent_runs INSERT ──────────────────────────────────────────────────────

await test("INSERT into agent_runs", async () => {
  const { status, body } = await postgrest("POST", "agent_runs", {
    id: TEST_RUN_ID,
    agent_id: TEST_AGENT_ID,
    session_id: TEST_SESSION_ID,
    operation: "alignment",
    status: "running",
    input_summary: "smoke-test alignment insert",
    created_at: NOW,
  });
  assert(
    status === 201 || status === 200,
    `Expected 200/201, got ${status}: ${JSON.stringify(body)}`
  );
});

await test("UPDATE agent_runs to completed", async () => {
  const { status, body } = await postgrest(
    "PATCH",
    "agent_runs",
    {
      status: "completed",
      output_summary: "score=0.92 status=aligned",
      completed_at: new Date().toISOString(),
      token_usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    },
    { "id=eq": TEST_RUN_ID }
  );
  assert(
    status === 200 || status === 204,
    `Expected 200/204, got ${status}: ${JSON.stringify(body)}`
  );
});

await test("SELECT agent_runs reads back completed run", async () => {
  const { status, body } = await postgrest("GET", "agent_runs", null, {
    "id=eq": TEST_RUN_ID,
  });
  assert(status === 200, `Expected 200, got ${status}`);
  assert(Array.isArray(body) && body.length > 0, "Expected non-empty array");
  assert(body[0].status === "completed", `Expected status=completed, got ${body[0].status}`);
});

// ── 3. loop_messages INSERT ───────────────────────────────────────────────────

await test("INSERT into loop_messages", async () => {
  const { status, body } = await postgrest("POST", "loop_messages", {
    id: TEST_MESSAGE_ID,
    loop_id: TEST_LOOP_ID,
    session_id: TEST_SESSION_ID,
    role: "user",
    content: "Smoke test loop message content for Supabase verification.",
    created_at: NOW,
  });
  assert(
    status === 201 || status === 200,
    `Expected 200/201, got ${status}: ${JSON.stringify(body)}`
  );
});

await test("SELECT loop_messages reads back message", async () => {
  const { status, body } = await postgrest("GET", "loop_messages", null, {
    "id=eq": TEST_MESSAGE_ID,
  });
  assert(status === 200, `Expected 200, got ${status}`);
  assert(Array.isArray(body) && body.length > 0, "Expected non-empty array");
  assert(body[0].role === "user", `Expected role=user, got ${body[0].role}`);
});

// ── 4. baseline_designs UPSERT ────────────────────────────────────────────────

await test("UPSERT into baseline_designs", async () => {
  const { status, body } = await postgrest("POST", "baseline_designs", {
    id: TEST_DESIGN_ID,
    agent_id: TEST_AGENT_ID,
    name: "smoke-test-design",
    spec: {
      alignment_threshold: 0.8,
      compression_ratio: 0.25,
      model: "gemini-1.5-pro-latest",
    },
    updated_at: NOW,
  });
  assert(
    status === 201 || status === 200,
    `Expected 200/201, got ${status}: ${JSON.stringify(body)}`
  );
});

await test("SELECT baseline_designs reads back design", async () => {
  const { status, body } = await postgrest("GET", "baseline_designs", null, {
    "id=eq": TEST_DESIGN_ID,
  });
  assert(status === 200, `Expected 200, got ${status}`);
  assert(Array.isArray(body) && body.length > 0, "Expected non-empty array");
  assert(body[0].name === "smoke-test-design", `Name mismatch: ${body[0].name}`);
});

// ── 5. Cleanup (best-effort) ──────────────────────────────────────────────────

console.log("\n🧹 Cleaning up test data...");

await Promise.allSettled([
  postgrest("DELETE", "agent_runs", null, { "id=eq": TEST_RUN_ID }),
  postgrest("DELETE", "loop_messages", null, { "id=eq": TEST_MESSAGE_ID }),
  postgrest("DELETE", "baseline_designs", null, { "id=eq": TEST_DESIGN_ID }),
]).then((results) => {
  const cleaned = results.filter((r) => r.status === "fulfilled").length;
  console.log(`   Cleaned ${cleaned}/3 test records`);
});

// ─── Report ───────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);

const report = {
  supabase_url: SUPABASE_URL,
  timestamp: NOW,
  summary: { passed, failed, total: passed + failed },
  tests: results,
};

writeFileSync("supabase-verify.json", JSON.stringify(report, null, 2));
console.log("Report written to supabase-verify.json");

if (failed > 0) {
  console.error(`\n💥 ${failed} Supabase test(s) failed.`);
  process.exit(1);
} else {
  console.log(`\n✅ All Supabase verification tests passed.`);
}
