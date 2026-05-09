-- ============================================================
-- SOVEREIGN.OS — Database Schema
-- Migration: 20260509_create_credits_ledger
-- Supabase / PostgreSQL 15+
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "vector"; -- pgvector for 768-dim embeddings

-- ============================================================
-- USERS & PROFILES
-- ============================================================

CREATE TABLE IF NOT EXISTS user_profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         TEXT UNIQUE NOT NULL,
  display_name  TEXT,
  avatar_url    TEXT,
  plan          TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro','enterprise')),
  timezone      TEXT DEFAULT 'UTC',
  birth_date    DATE,          -- for astrology overlay (optional, user-supplied)
  birth_place   TEXT,          -- city/coords for natal chart
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_profiles_email ON user_profiles (email);

-- ============================================================
-- CREDITS LEDGER
-- ============================================================

CREATE TABLE IF NOT EXISTS credits_ledger (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount          INTEGER NOT NULL,  -- positive=credit, negative=debit
  balance_after   INTEGER NOT NULL,
  operation       TEXT NOT NULL,     -- 'alignment','compression','embed','simulator','purchase','provision','refund','expiry'
  reference_id    TEXT,              -- session_id, stripe payment_intent, etc.
  idempotency_key TEXT UNIQUE,       -- prevents double-crediting
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_credits_ledger_user_id  ON credits_ledger (user_id, created_at DESC);
CREATE INDEX idx_credits_ledger_ref      ON credits_ledger (reference_id) WHERE reference_id IS NOT NULL;

-- Materialised view for current balances (refreshed by trigger)
CREATE TABLE IF NOT EXISTS credit_balances (
  user_id  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance  INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Atomic credit deduction function (returns new balance or raises if insufficient)
CREATE OR REPLACE FUNCTION deduct_credits(
  p_user_id        UUID,
  p_amount         INTEGER,
  p_operation      TEXT,
  p_reference_id   TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_current INTEGER;
  v_new     INTEGER;
BEGIN
  -- Idempotency guard
  IF p_idempotency_key IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM credits_ledger WHERE idempotency_key = p_idempotency_key) THEN
      SELECT balance INTO v_new FROM credit_balances WHERE user_id = p_user_id;
      RETURN v_new;
    END IF;
  END IF;

  -- Lock the balance row
  SELECT balance INTO v_current FROM credit_balances WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User credits not initialised';
  END IF;
  IF v_current < p_amount THEN
    RAISE EXCEPTION 'Insufficient credits: have %, need %', v_current, p_amount;
  END IF;

  v_new := v_current - p_amount;

  UPDATE credit_balances SET balance = v_new, updated_at = NOW() WHERE user_id = p_user_id;

  INSERT INTO credits_ledger (user_id, amount, balance_after, operation, reference_id, idempotency_key)
  VALUES (p_user_id, -p_amount, v_new, p_operation, p_reference_id, p_idempotency_key);

  RETURN v_new;
END;
$$;

-- Provision credits for new users
CREATE OR REPLACE FUNCTION provision_new_user_credits(
  p_user_id UUID,
  p_credits  INTEGER DEFAULT 100
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO credit_balances (user_id, balance)
  VALUES (p_user_id, p_credits)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO credits_ledger (user_id, amount, balance_after, operation, idempotency_key)
  VALUES (p_user_id, p_credits, p_credits, 'provision', 'provision-' || p_user_id::TEXT)
  ON CONFLICT (idempotency_key) DO NOTHING;
END;
$$;

-- ============================================================
-- AGENT INFRASTRUCTURE
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_manifests (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id     TEXT UNIQUE NOT NULL,
  name         TEXT NOT NULL,
  version      TEXT NOT NULL,
  spec         JSONB NOT NULL,
  is_active    BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id       TEXT NOT NULL,
  session_id     UUID NOT NULL,
  user_id        UUID REFERENCES auth.users(id),
  operation      TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('pending','running','completed','failed')),
  input_summary  TEXT,
  output_summary TEXT,
  error_message  TEXT,
  token_usage    JSONB,
  credits_used   INTEGER DEFAULT 0,
  completed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agent_runs_session   ON agent_runs (session_id);
CREATE INDEX idx_agent_runs_user      ON agent_runs (user_id, created_at DESC);
CREATE INDEX idx_agent_runs_status    ON agent_runs (status) WHERE status IN ('pending','running');

-- ============================================================
-- LOOP MESSAGES (The Loop / context threads)
-- ============================================================

CREATE TABLE IF NOT EXISTS loop_messages (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  loop_id     UUID NOT NULL,
  session_id  UUID NOT NULL,
  user_id     UUID REFERENCES auth.users(id),
  role        TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content     TEXT NOT NULL,
  embedding   vector(768),         -- pgvector 768-dim (text-embedding-004)
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_loop_messages_loop    ON loop_messages (loop_id, created_at);
CREATE INDEX idx_loop_messages_session ON loop_messages (session_id);
-- HNSW index for nearest-neighbour search
CREATE INDEX idx_loop_messages_embed ON loop_messages
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- ============================================================
-- BASELINE DESIGNS
-- ============================================================

CREATE TABLE IF NOT EXISTS baseline_designs (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id     TEXT NOT NULL,
  user_id      UUID REFERENCES auth.users(id),
  name         TEXT NOT NULL,
  spec         JSONB NOT NULL,
  embedding    vector(768),
  is_active    BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- WEBHOOK EVENTS (idempotency store)
-- ============================================================

CREATE TABLE IF NOT EXISTS webhook_events (
  id               UUID PRIMARY KEY,
  event_type       TEXT NOT NULL,
  idempotency_key  TEXT UNIQUE NOT NULL,
  data             JSONB DEFAULT '{}',
  processed_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- MEDIA & STORY PIPELINE
-- ============================================================

CREATE TABLE IF NOT EXISTS media_jobs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES auth.users(id),
  session_id      UUID,
  type            TEXT NOT NULL CHECK (type IN ('story','storyboard','video','audio')),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
  input_data      JSONB DEFAULT '{}',
  output_url      TEXT,
  error_message   TEXT,
  storage_bucket  TEXT,
  storage_key     TEXT,
  credits_used    INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX idx_media_jobs_user   ON media_jobs (user_id, created_at DESC);
CREATE INDEX idx_media_jobs_status ON media_jobs (status) WHERE status IN ('pending','processing');

-- ============================================================
-- ASTROLOGY OVERLAYS
-- ============================================================

CREATE TABLE IF NOT EXISTS astrology_overlays (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES auth.users(id),
  natal_chart  JSONB,
  transit_data JSONB,
  synthesis    TEXT,           -- AI-generated synthesis text
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at   TIMESTAMPTZ DEFAULT NOW() + INTERVAL '24 hours'
);

CREATE INDEX idx_astrology_user ON astrology_overlays (user_id, generated_at DESC);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE user_profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE credits_ledger     ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_balances    ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE loop_messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE baseline_designs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_jobs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE astrology_overlays ENABLE ROW LEVEL SECURITY;

-- Users can only see their own data
CREATE POLICY "own profile"  ON user_profiles      FOR ALL USING (id = auth.uid());
CREATE POLICY "own credits"  ON credits_ledger     FOR ALL USING (user_id = auth.uid());
CREATE POLICY "own balance"  ON credit_balances    FOR ALL USING (user_id = auth.uid());
CREATE POLICY "own runs"     ON agent_runs         FOR ALL USING (user_id = auth.uid());
CREATE POLICY "own messages" ON loop_messages      FOR ALL USING (user_id = auth.uid());
CREATE POLICY "own designs"  ON baseline_designs   FOR ALL USING (user_id = auth.uid());
CREATE POLICY "own media"    ON media_jobs         FOR ALL USING (user_id = auth.uid());
CREATE POLICY "own astro"    ON astrology_overlays FOR ALL USING (user_id = auth.uid());

-- Service role bypasses RLS (used by Worker)
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
