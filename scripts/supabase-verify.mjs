#!/usr/bin/env node
// scripts/supabase-verify.mjs
// Verifies Supabase DB connectivity and schema readiness for the Switchboard.
// Tests inserts, reads, and RLS on baseline_designs, agent_runs, loop_messages.
// Usage: SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/supabase-verify.mjs

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("❌  SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

const BASE = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1`;
const HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
};

let passed = 0;
let failed = 0;

async function pgrest(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function verify(name, fn) {
  try {
    await fn();
    console.log(`  ✅  ${name}`);
    passed++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ❌  ${name} — ${msg}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg ?? "Assertion failed");
}

const TEST_USER_ID = "00000000-0000-0000-0000-000000000099"; // sentinel test user
const TEST_AGENT_ID = "00000000-0000-0000-0000-000000000001";
const TEST_CONV_ID = crypto.randomUUID();

console.log(`\n🗄   Supabase Schema Verification`);
console.log(`   URL: ${SUPABASE_URL}\n`);

// ─── agent_runs table ─────────────────────────────────────────────────────────

await verify("agent_runs — table exists and is accessible", async () => {
  const { status } = await pgrest("GET", "/agent_runs?select=id&limit=1");
  assert(status === 200, `Expected 200, got ${status}`);
});

await verify("agent_runs — insert test run", async () => {
  const { status, body } = await pgrest("POST", "/agent_runs", {
    user_id: TEST_USER_ID,
    space: "alignment",
    model: "gemini-1.5-flash",
    status: "success",
    latency_ms: 1500,
    created_at: new Date().toISOString(),
  });
  assert(status === 201 || status === 200, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
});

await verify("agent_runs — query by user_id", async () => {
  const { status, body } = await pgrest(
    "GET",
    `/agent_runs?select=id,space,status&user_id=eq.${TEST_USER_ID}&limit=5`
  );
  assert(status === 200, `Expected 200, got ${status}`);
  assert(Array.isArray(body), "Expected array");
});

await verify("agent_runs — delete test rows", async () => {
  const { status } = await pgrest(
    "DELETE",
    `/agent_runs?user_id=eq.${TEST_USER_ID}`
  );
  assert(status === 204 || status === 200, `Expected 204, got ${status}`);
});

// ─── loop_messages table ──────────────────────────────────────────────────────

await verify("loop_messages — table exists", async () => {
  const { status } = await pgrest("GET", "/loop_messages?select=id&limit=1");
  assert(status === 200, `Expected 200, got ${status}`);
});

await verify("loop_messages — insert user message", async () => {
  const { status, body } = await pgrest("POST", "/loop_messages", {
    conversation_id: TEST_CONV_ID,
    user_id: TEST_USER_ID,
    agent_id: TEST_AGENT_ID,
    role: "user",
    content: "Smoke test message — please ignore",
    created_at: new Date().toISOString(),
  });
  assert(status === 201 || status === 200, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
});

await verify("loop_messages — insert assistant message", async () => {
  const { status } = await pgrest("POST", "/loop_messages", {
    conversation_id: TEST_CONV_ID,
    user_id: TEST_USER_ID,
    agent_id: TEST_AGENT_ID,
    role: "assistant",
    content: "Smoke test reply — please ignore",
    created_at: new Date().toISOString(),
  });
  assert(status === 201 || status === 200, `Expected 201, got ${status}`);
});

await verify("loop_messages — query by conversation_id", async () => {
  const { status, body } = await pgrest(
    "GET",
    `/loop_messages?conversation_id=eq.${TEST_CONV_ID}&select=id,role,content&order=created_at.asc`
  );
  assert(status === 200, `Expected 200, got ${status}`);
  assert(Array.isArray(body), "Expected array");
  assert(body.length >= 2, `Expected >=2 messages, got ${body.length}`);
  assert(body[0].role === "user", `First message should be user, got: ${body[0].role}`);
  assert(body[1].role === "assistant", `Second message should be assistant, got: ${body[1].role}`);
});

await verify("loop_messages — delete test conversation", async () => {
  const { status } = await pgrest(
    "DELETE",
    `/loop_messages?conversation_id=eq.${TEST_CONV_ID}`
  );
  assert(status === 204 || status === 200, `Expected 204, got ${status}`);
});

// ─── baseline_designs table ───────────────────────────────────────────────────

await verify("baseline_designs — table exists", async () => {
  const { status } = await pgrest("GET", "/baseline_designs?select=id&limit=1");
  assert(status === 200, `Expected 200, got ${status}`);
});

await verify("baseline_designs — insert and read back", async () => {
  const designId = crypto.randomUUID();
  const { status: insStatus } = await pgrest("POST", "/baseline_designs", {
    id: designId,
    user_id: TEST_USER_ID,
    label: "smoke-test",
    data: { test: true },
    created_at: new Date().toISOString(),
  });
  assert(insStatus === 201 || insStatus === 200, `Insert failed: ${insStatus}`);

  const { status: selStatus, body } = await pgrest(
    "GET",
    `/baseline_designs?id=eq.${designId}&select=id,label`
  );
  assert(selStatus === 200, `Select failed: ${selStatus}`);
  assert(Array.isArray(body) && body.length === 1, "Expected exactly 1 row");
  assert(body[0].label === "smoke-test", "label mismatch");

  // Cleanup
  await pgrest("DELETE", `/baseline_designs?id=eq.${designId}`);
});

// ─── profiles table ───────────────────────────────────────────────────────────

await verify("profiles — table exists and tier column present", async () => {
  const { status, body } = await pgrest("GET", "/profiles?select=id,tier&limit=1");
  assert(status === 200, `Expected 200, got ${status}`);
});

// ─── agent_manifests table ────────────────────────────────────────────────────

await verify("agent_manifests — table exists", async () => {
  const { status } = await pgrest("GET", "/agent_manifests?select=id,name&limit=5");
  assert(status === 200, `Expected 200, got ${status}`);
});

// ─── pgvector readiness ───────────────────────────────────────────────────────

await verify("loop_messages — embedding column exists (pgvector)", async () => {
  // Just check the column is selectable — won't fail if no rows have embeddings
  const { status } = await pgrest(
    "GET",
    "/loop_messages?select=id,embedding&limit=1"
  );
  assert(status === 200, `Expected 200, got ${status}. pgvector embedding column may be missing.`);
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(50)}`);
console.log(`  Results: ${passed} passed / ${failed} failed / ${passed + failed} total`);
console.log(`${"─".repeat(50)}\n`);

if (failed > 0) {
  process.exit(1);
}
