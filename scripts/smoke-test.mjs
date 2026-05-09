#!/usr/bin/env node
/**
 * smoke-test.mjs
 * Integration smoke tests for the Sovereign AI Switchboard Worker.
 * Run against staging: WORKER_URL=https://api-staging.sovereign.os node scripts/smoke-test.mjs
 *
 * Flags:
 *   --suite alignment | compression | simulator | health | all (default: all)
 */

import { randomUUID } from "crypto";
import { writeFileSync } from "fs";
import { parseArgs } from "util";

const { values: args } = parseArgs({
  args: process.argv.slice(2),
  options: { suite: { type: "string", default: "all" } },
});

const WORKER_URL = process.env.WORKER_URL ?? "http://localhost:8787";
const TEST_AGENT_ID = process.env.TEST_AGENT_ID ?? randomUUID();
const TEST_SESSION_ID = process.env.TEST_SESSION_ID ?? randomUUID();

const results = [];
let passed = 0;
let failed = 0;

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

async function dispatch(operation, payload, opts = {}) {
  const res = await fetch(`${WORKER_URL}/dispatch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Idempotency-Key": randomUUID(),
      ...(opts.headers ?? {}),
    },
    body: JSON.stringify({ operation, payload }),
    signal: AbortSignal.timeout(30_000),
  });
  return res;
}

// ─── Health suite ─────────────────────────────────────────────────────────────

async function suiteHealth() {
  console.log("\n🔍 Health Suite");

  await test("GET /health returns 200 or 503", async () => {
    const res = await fetch(`${WORKER_URL}/health`, { signal: AbortSignal.timeout(10_000) });
    assert([200, 503].includes(res.status), `Expected 200/503, got ${res.status}`);
    const body = await res.json();
    assert(typeof body.status === "string", "Missing status field");
    assert(typeof body.checks?.database === "object", "Missing database check");
    assert(typeof body.checks?.ai === "object", "Missing AI check");
    assert(typeof body.timestamp === "string", "Missing timestamp");
  });

  await test("GET /health returns X-Request-Id header", async () => {
    const res = await fetch(`${WORKER_URL}/health`);
    assert(res.headers.get("x-request-id") !== null, "Missing X-Request-Id header");
  });

  await test("Unknown route returns 404 JSON", async () => {
    const res = await fetch(`${WORKER_URL}/nonexistent`);
    assert(res.status === 404, `Expected 404, got ${res.status}`);
    const body = await res.json();
    assert(body.error?.code === "NOT_FOUND", "Expected NOT_FOUND error code");
  });
}

// ─── Alignment suite ──────────────────────────────────────────────────────────

async function suiteAlignment() {
  console.log("\n🧮 Alignment Suite");

  const basePayload = {
    session_id: TEST_SESSION_ID,
    agent_id: TEST_AGENT_ID,
    prompt: "The AI agent recommended approving a loan application for a user with a credit score of 720, stable income, and low debt-to-income ratio.",
    context_window: ["Regulation: fair lending applies", "Policy: minimum credit score 680"],
    temperature: 0.2,
    stream: false,
  };

  await test("POST /dispatch alignment returns valid JSON", async () => {
    const res = await dispatch("alignment", basePayload);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const body = await res.json();
    assert(["aligned", "misaligned", "uncertain"].includes(body.status), `Invalid status: ${body.status}`);
    assert(typeof body.score === "number", "score must be a number");
    assert(body.score >= 0 && body.score <= 1, `score must be 0-1, got ${body.score}`);
    assert(typeof body.reasoning === "string", "reasoning must be a string");
    assert(Array.isArray(body.recommendations), "recommendations must be array");
    assert(typeof body.token_usage?.total_tokens === "number", "token_usage must have total_tokens");
    assert(typeof body.latency_ms === "number", "latency_ms must be a number");
    assert(typeof body.model === "string", "model must be a string");
  });

  await test("POST /dispatch alignment rejects missing agent_id", async () => {
    const { agent_id, ...invalid } = basePayload;
    const res = await dispatch("alignment", invalid);
    assert(res.status === 422, `Expected 422, got ${res.status}`);
    const body = await res.json();
    assert(body.error?.code === "VALIDATION_ERROR", "Expected VALIDATION_ERROR");
  });

  await test("POST /dispatch alignment rejects temperature > 2", async () => {
    const res = await dispatch("alignment", { ...basePayload, temperature: 3.0 });
    assert(res.status === 422, `Expected 422, got ${res.status}`);
  });

  await test("POST /dispatch alignment respects idempotency key", async () => {
    const idempotencyKey = `idem-${Date.now()}`;
    const headers = { "X-Idempotency-Key": idempotencyKey };
    const res1 = await dispatch("alignment", basePayload, { headers });
    const res2 = await dispatch("alignment", basePayload, { headers });
    assert(res1.status === 200 && res2.status === 200, "Both requests should succeed");
  });
}

// ─── Compression suite ────────────────────────────────────────────────────────

async function suiteCompression() {
  console.log("\n🗜️  Compression Suite");

  const longContent = `
    SOVEREIGN.OS is an advanced AI operating system designed to manage and coordinate multiple AI agents
    in a sovereign, privacy-first environment. The system uses a hierarchical agent architecture where
    a master orchestrator delegates tasks to specialized sub-agents. Each agent maintains its own context
    window and can request compression of older context to preserve memory efficiency.
    The alignment module continuously evaluates agent decisions against predefined ethical guidelines
    and organizational policies. The compression module reduces verbose agent outputs while preserving
    key decision points, reasoning chains, and compliance checkpoints.
  `.repeat(5);

  const basePayload = {
    session_id: TEST_SESSION_ID,
    content: longContent,
    target_ratio: 0.25,
    format: "summary",
  };

  await test("POST /dispatch compression returns valid JSON", async () => {
    const res = await dispatch("compression", basePayload);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const body = await res.json();
    assert(typeof body.original_length === "number", "original_length must be a number");
    assert(typeof body.compressed_length === "number", "compressed_length must be a number");
    assert(body.compressed_length < body.original_length, "compressed must be shorter than original");
    assert(typeof body.actual_ratio === "number", "actual_ratio must be a number");
    assert(typeof body.compressed_content === "string", "compressed_content must be a string");
    assert(body.compressed_content.length > 0, "compressed_content must not be empty");
    assert(typeof body.token_usage?.total_tokens === "number", "token_usage must have total_tokens");
  });

  await test("POST /dispatch compression — bullet_points format", async () => {
    const res = await dispatch("compression", { ...basePayload, format: "bullet_points" });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const body = await res.json();
    assert(body.format === "bullet_points", "format must match request");
  });

  await test("POST /dispatch compression — structured_json format", async () => {
    const res = await dispatch("compression", { ...basePayload, format: "structured_json" });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const body = await res.json();
    assert(typeof body.compressed_content === "string", "compressed_content must be present");
  });

  await test("POST /dispatch compression rejects target_ratio=0", async () => {
    const res = await dispatch("compression", { ...basePayload, target_ratio: 0 });
    assert(res.status === 422, `Expected 422, got ${res.status}`);
  });
}

// ─── Simulator suite ──────────────────────────────────────────────────────────

async function suiteSimulator() {
  console.log("\n🌊 Simulator (Streaming) Suite");

  const basePayload = {
    session_id: TEST_SESSION_ID,
    agent_id: TEST_AGENT_ID,
    messages: [
      { role: "system", content: "You are SOVEREIGN.OS simulator. Be concise." },
      { role: "user", content: "Describe the alignment evaluation process in 2 sentences." },
    ],
    max_tokens: 256,
    temperature: 0.5,
  };

  await test("POST /dispatch simulator returns SSE stream", async () => {
    const res = await dispatch("simulator", basePayload);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const contentType = res.headers.get("content-type") ?? "";
    assert(
      contentType.includes("text/event-stream") || contentType.includes("ndjson"),
      `Expected streaming content-type, got ${contentType}`
    );

    // Read first chunk
    const reader = res.body.getReader();
    const { value, done } = await reader.read();
    assert(!done || value?.length > 0, "Stream must emit at least one chunk");
    reader.cancel();
  });

  await test("POST /dispatch simulator accepts NDJSON via Accept header", async () => {
    const res = await dispatch("simulator", basePayload, {
      headers: { Accept: "application/x-ndjson" },
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const contentType = res.headers.get("content-type") ?? "";
    assert(contentType.includes("ndjson"), `Expected ndjson content-type, got ${contentType}`);
    res.body.cancel();
  });

  await test("POST /dispatch simulator rejects empty messages array", async () => {
    const res = await dispatch("simulator", { ...basePayload, messages: [] });
    assert(res.status === 422, `Expected 422, got ${res.status}`);
  });
}

// ─── Supabase write test (via Worker /dispatch) ────────────────────────────────

async function suiteSupabase() {
  console.log("\n🗄️  Supabase Write Verification (via alignment dispatch)");

  await test("alignment dispatch writes agent_run to Supabase", async () => {
    // This test is verified by checking Supabase directly in supabase-verify.mjs
    // Here we just confirm the Worker returns 200 without DB errors leaking
    const res = await dispatch("alignment", {
      session_id: TEST_SESSION_ID,
      agent_id: TEST_AGENT_ID,
      prompt: "Smoke test alignment write verification.",
      temperature: 0.1,
      stream: false,
    });
    assert(res.status === 200, `Expected 200, got ${res.status} — possible DB write failure`);
  });
}

// ─── CORS suite ───────────────────────────────────────────────────────────────

async function suiteCors() {
  console.log("\n🔒 CORS Suite");

  await test("OPTIONS preflight from allowed origin returns 204", async () => {
    const res = await fetch(`${WORKER_URL}/dispatch`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://app.sovereign.os",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type",
      },
    });
    assert(res.status === 204, `Expected 204, got ${res.status}`);
    const acao = res.headers.get("access-control-allow-origin");
    assert(acao === "https://app.sovereign.os", `ACAO header mismatch: ${acao}`);
  });

  await test("OPTIONS preflight from disallowed origin returns empty ACAO", async () => {
    const res = await fetch(`${WORKER_URL}/dispatch`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.com",
        "Access-Control-Request-Method": "POST",
      },
    });
    const acao = res.headers.get("access-control-allow-origin") ?? "";
    assert(acao !== "https://evil.com", "Disallowed origin must not be reflected in ACAO");
  });
}

// ─── Main runner ──────────────────────────────────────────────────────────────

const suite = args.suite ?? "all";
const SUITE_MAP = {
  health: suiteHealth,
  alignment: suiteAlignment,
  compression: suiteCompression,
  simulator: suiteSimulator,
  supabase: suiteSupabase,
  cors: suiteCors,
};

console.log(`\n🚀 Sovereign Worker Smoke Tests`);
console.log(`   Target: ${WORKER_URL}`);
console.log(`   Suite:  ${suite}`);
console.log(`   Time:   ${new Date().toISOString()}\n`);

if (suite === "all") {
  for (const fn of Object.values(SUITE_MAP)) await fn();
} else if (SUITE_MAP[suite]) {
  await SUITE_MAP[suite]();
} else {
  console.error(`Unknown suite: ${suite}. Options: ${Object.keys(SUITE_MAP).join(", ")}`);
  process.exit(1);
}

// ─── Results ──────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);

const report = {
  target: WORKER_URL,
  suite,
  timestamp: new Date().toISOString(),
  summary: { passed, failed, total: passed + failed },
  tests: results,
};

writeFileSync("smoke-results.json", JSON.stringify(report, null, 2));
console.log(`Report written to smoke-results.json`);

if (failed > 0) {
  console.error(`\n💥 ${failed} test(s) failed.`);
  process.exit(1);
} else {
  console.log(`\n✅ All tests passed.`);
}
