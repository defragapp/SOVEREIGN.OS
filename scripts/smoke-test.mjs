#!/usr/bin/env node
// scripts/smoke-test.mjs
// Integration smoke tests for the Sovereign AI Switchboard.
// Runs alignment, compression, defrag, launcher, and health checks against a live Worker.
// Usage: WORKER_URL=https://api-staging.sovereign.os TEST_USER_ID=<uuid> node scripts/smoke-test.mjs

import { writeFileSync } from "fs";

const WORKER_URL = process.env.WORKER_URL ?? "http://localhost:8787";
const TEST_USER_ID = process.env.TEST_USER_ID ?? "00000000-0000-0000-0000-000000000001";
const RESULTS_PATH = "/tmp/smoke-results.json";

const results = [];
let passed = 0;
let failed = 0;

// ─── Test runner ──────────────────────────────────────────────────────────────

async function test(name, fn) {
  const start = Date.now();
  try {
    await fn();
    const ms = Date.now() - start;
    console.log(`  ✅  ${name} (${ms}ms)`);
    results.push({ name, status: "pass", latency_ms: ms });
    passed++;
  } catch (err) {
    const ms = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`  ❌  ${name} — ${message} (${ms}ms)`);
    results.push({ name, status: "fail", error: message, latency_ms: ms });
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

async function dispatch(space, payload, idempotencyKey) {
  const headers = {
    "Content-Type": "application/json",
    Origin: "https://sovereign.os",
  };
  if (idempotencyKey) headers["X-Idempotency-Key"] = idempotencyKey;

  const res = await fetch(`${WORKER_URL}/dispatch`, {
    method: "POST",
    headers,
    body: JSON.stringify({ space, user_id: TEST_USER_ID, payload }),
    signal: AbortSignal.timeout(30_000),
  });
  return res;
}

// ─── Health check ─────────────────────────────────────────────────────────────

console.log(`\n🔍  Sovereign AI Switchboard Smoke Tests`);
console.log(`   Target: ${WORKER_URL}`);
console.log(`   User:   ${TEST_USER_ID}\n`);

await test("/health — returns 200 with status", async () => {
  const res = await fetch(`${WORKER_URL}/health`, {
    signal: AbortSignal.timeout(10_000),
  });
  assert(res.status === 200 || res.status === 503, `Unexpected status ${res.status}`);
  const body = await res.json();
  assert(typeof body.status === "string", "Missing status field");
  assert(["healthy", "degraded", "unhealthy"].includes(body.status), `Unknown status: ${body.status}`);
  assert(typeof body.timestamp === "string", "Missing timestamp");
  assert(body.checks && typeof body.checks.supabase === "string", "Missing checks.supabase");
  assert(body.checks && typeof body.checks.ai === "string", "Missing checks.ai");
  console.log(`       status=${body.status} supabase=${body.checks.supabase} ai=${body.checks.ai}`);
});

// ─── CORS preflight ───────────────────────────────────────────────────────────

await test("CORS preflight — accepts sovereign.os origin", async () => {
  const res = await fetch(`${WORKER_URL}/dispatch`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://sovereign.os",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "Content-Type",
    },
    signal: AbortSignal.timeout(5_000),
  });
  assert(res.status === 204 || res.status === 200, `Expected 204, got ${res.status}`);
  const acao = res.headers.get("Access-Control-Allow-Origin");
  assert(acao === "https://sovereign.os", `Bad ACAO: ${acao}`);
});

await test("CORS preflight — rejects unknown origin", async () => {
  const res = await fetch(`${WORKER_URL}/dispatch`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://evil.com",
      "Access-Control-Request-Method": "POST",
    },
    signal: AbortSignal.timeout(5_000),
  });
  const acao = res.headers.get("Access-Control-Allow-Origin");
  assert(!acao || acao === "null", `Should have rejected evil.com, got: ${acao}`);
});

// ─── Validation ───────────────────────────────────────────────────────────────

await test("/dispatch — 422 on invalid envelope (missing space)", async () => {
  const res = await fetch(`${WORKER_URL}/dispatch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://sovereign.os" },
    body: JSON.stringify({ user_id: TEST_USER_ID, payload: {} }),
    signal: AbortSignal.timeout(5_000),
  });
  assert(res.status === 422, `Expected 422, got ${res.status}`);
  const body = await res.json();
  assert(body.code === "VALIDATION_ERROR", `Expected VALIDATION_ERROR, got: ${body.code}`);
});

await test("/dispatch — 422 on invalid user_id (not UUID)", async () => {
  const res = await dispatch("alignment", { dob: "1990-01-15" });
  // Note: this will fail because TEST_USER_ID above IS a UUID — let's use a bad one
  const res2 = await fetch(`${WORKER_URL}/dispatch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://sovereign.os" },
    body: JSON.stringify({ space: "alignment", user_id: "not-a-uuid", payload: { dob: "1990-01-15" } }),
    signal: AbortSignal.timeout(5_000),
  });
  assert(res2.status === 422, `Expected 422, got ${res2.status}`);
});

await test("/dispatch — 413 on oversized body", async () => {
  const hugePayload = "x".repeat(260_000);
  const res = await fetch(`${WORKER_URL}/dispatch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": String(hugePayload.length),
      Origin: "https://sovereign.os",
    },
    body: JSON.stringify({ space: "alignment", user_id: TEST_USER_ID, payload: { content: hugePayload } }),
    signal: AbortSignal.timeout(5_000),
  });
  assert(res.status === 413, `Expected 413, got ${res.status}`);
});

// ─── Launcher ─────────────────────────────────────────────────────────────────

await test("/dispatch launcher — returns suggested_space", async () => {
  const res = await dispatch("launcher", { intent: "I feel scattered and can't focus today" });
  assert(res.status === 200, `Expected 200, got ${res.status}: ${await res.text()}`);
  const body = await res.json();
  assert(typeof body.suggested_space === "string", "Missing suggested_space");
  assert(typeof body.reason === "string", "Missing reason");
  assert(typeof body.opening_question === "string", "Missing opening_question");
  console.log(`       suggested_space=${body.suggested_space}`);
});

// ─── Alignment ────────────────────────────────────────────────────────────────

await test("/dispatch alignment — returns valid AlignmentResponse", async () => {
  const res = await dispatch("alignment", {
    dob: "1993-07-15",
    time_of_birth: "08:30",
    timezone: "America/Los_Angeles",
    question: "What should I focus on this month?",
    depth: "brief",
  });
  assert(res.status === 200, `Expected 200, got ${res.status}: ${await res.text()}`);
  const body = await res.json();
  assert(typeof body.reading === "string" && body.reading.length > 10, "Missing or short reading");
  assert(Array.isArray(body.archetypes), "archetypes not an array");
  assert(body.archetypes.length <= 5, "archetypes exceeds 5");
  assert(typeof body.guidance === "string", "Missing guidance");
  assert(Array.isArray(body.themes), "themes not an array");
  assert(typeof body.generated_at === "string", "Missing generated_at");
  console.log(`       archetypes=[${body.archetypes.join(", ")}]`);
});

await test("/dispatch alignment — 422 on bad dob format", async () => {
  const res = await dispatch("alignment", { dob: "07/15/1993" });
  assert(res.status === 422, `Expected 422, got ${res.status}`);
});

// ─── Compression ──────────────────────────────────────────────────────────────

await test("/dispatch compression — returns CompressionResponse", async () => {
  const res = await dispatch("compression", {
    content:
      "I have been thinking about this for a long time, turning it over and over in my mind. " +
      "There is a thread here — something about the gap between who I am and who I want to become. " +
      "I keep circling back to the same questions, the same resistance, the same small voice that says not yet.",
    mode: "distill",
    output_format: "prose",
  });
  // Note: compression is pro-only. If test user is free tier, expect 403.
  if (res.status === 403) {
    console.log(`       ⚠ Pro-gated (403) — expected for free test user`);
    return;
  }
  assert(res.status === 200, `Expected 200, got ${res.status}: ${await res.text()}`);
  const body = await res.json();
  assert(typeof body.compressed === "string", "Missing compressed");
  assert(typeof body.compression_ratio === "number", "Missing compression_ratio");
  assert(body.compression_ratio >= 0 && body.compression_ratio <= 1, "Bad compression_ratio");
  console.log(`       ratio=${body.compression_ratio} words: ${body.word_count_original}→${body.word_count_compressed}`);
});

// ─── Defrag ───────────────────────────────────────────────────────────────────

await test("/dispatch defrag — returns clusters", async () => {
  const res = await dispatch("defrag", {
    entries: [
      { id: "e1", text: "I keep putting off the career conversation." },
      { id: "e2", text: "I want to move cities but feel stuck." },
      { id: "e3", text: "My mornings feel rushed and anxious." },
      { id: "e4", text: "I haven't called my dad in three weeks." },
    ],
    output_format: "clusters",
  });
  assert(res.status === 200, `Expected 200, got ${res.status}: ${await res.text()}`);
  const body = await res.json();
  assert(Array.isArray(body.clusters), "Missing clusters array");
  assert(body.clusters.length >= 1, "Expected at least one cluster");
  assert(typeof body.overall_pattern === "string", "Missing overall_pattern");
  assert(typeof body.next_focus === "string", "Missing next_focus");
  console.log(`       clusters=${body.clusters.length} pattern="${body.overall_pattern.slice(0, 60)}..."`);
});

// ─── 404 ─────────────────────────────────────────────────────────────────────

await test("404 on unknown route", async () => {
  const res = await fetch(`${WORKER_URL}/unknown-route`, {
    signal: AbortSignal.timeout(5_000),
  });
  assert(res.status === 404, `Expected 404, got ${res.status}`);
  const body = await res.json();
  assert(body.code === "NOT_FOUND", `Expected NOT_FOUND, got: ${body.code}`);
});

// ─── Request ID header ────────────────────────────────────────────────────────

await test("X-Request-ID echoed in response", async () => {
  const myId = "smoke-test-" + Date.now();
  const res = await fetch(`${WORKER_URL}/health`, {
    headers: { "X-Request-ID": myId },
    signal: AbortSignal.timeout(5_000),
  });
  const echoed = res.headers.get("X-Request-ID");
  assert(echoed === myId, `Expected ${myId}, got ${echoed}`);
});

// ─── Results ─────────────────────────────────────────────────────────────────

const summary = {
  run_at: new Date().toISOString(),
  worker_url: WORKER_URL,
  total: passed + failed,
  passed,
  failed,
  results,
};

writeFileSync(RESULTS_PATH, JSON.stringify(summary, null, 2));

console.log(`\n${"─".repeat(50)}`);
console.log(`  Results: ${passed} passed / ${failed} failed / ${passed + failed} total`);
console.log(`  Report:  ${RESULTS_PATH}`);
console.log(`${"─".repeat(50)}\n`);

if (failed > 0) {
  process.exit(1);
}
