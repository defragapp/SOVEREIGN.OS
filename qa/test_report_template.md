# SOVEREIGN.OS — QA Test Report

**Build:** `{{ BUILD_TAG }}`
**Date:** `{{ DATE }}`
**Environment:** `{{ ENVIRONMENT }}` <!-- staging | production -->
**Tester:** `{{ TESTER }}`
**Commit:** `{{ COMMIT_SHA }}`

---

## 1. Summary

| Category | Pass | Fail | Skipped | Total |
|---|---|---|---|---|
| Smoke / Health | | | | |
| Auth Flows | | | | |
| Space — Defrag | | | | |
| Space — Alignment | | | | |
| Space — Loop | | | | |
| Space — Compression | | | | |
| Space — Covenant | | | | |
| Subscription / Billing | | | | |
| PWA / Offline | | | | |
| Accessibility | | | | |
| **TOTAL** | | | | |

**Overall result:** ✅ PASS / ❌ FAIL / ⚠️ CONDITIONAL PASS

---

## 2. Environment Checklist

- [ ] Worker health endpoint returns 200 with `{ status: "ok" }`
- [ ] Supabase PostgREST reachable from Worker
- [ ] Gemini API key valid (probe returns non-error)
- [ ] Stripe webhook secret active
- [ ] Staging domain resolving: `api-staging.sovereign.os`
- [ ] Production domain resolving: `api.sovereign.os`
- [ ] Vercel deployment URL live
- [ ] PWA manifest accessible at `/manifest.json`
- [ ] Service worker registered without error

---

## 3. Smoke Tests (automated — `scripts/smoke-test.mjs`)

| Test | Status | Notes |
|---|---|---|
| GET /health | | |
| POST /dispatch (alignment) | | |
| POST /dispatch (compression) | | |
| POST /dispatch (simulator, streaming) | | |
| POST /dispatch (embed) | | |
| Supabase insert/read/delete | | |
| CORS preflight (allowed origin) | | |
| CORS rejection (unknown origin) | | |
| Rate limit header present | | |

---

## 4. Auth Flows

| Test Case | Steps | Expected | Status | Notes |
|---|---|---|---|---|
| Google OAuth sign-in | Click "Continue with Google", complete OAuth | Lands on /launcher, session established | | |
| Apple OAuth sign-in | Click "Continue with Apple", complete OAuth | Lands on /launcher, session established | | |
| Email magic link | Enter email, receive link, click | Lands on /launcher | | |
| Sign out | Click sign out | Session cleared, redirected to /auth/signin | | |
| Protected route redirect | Navigate to /defrag without session | Redirected to /auth/signin | | |
| Session persistence | Hard refresh after sign-in | Session maintained | | |

---

## 5. Space Tests

### 5.1 Launcher
| Test | Expected | Status | Notes |
|---|---|---|---|
| Space grid renders all 6 cards | 6 cards visible with correct labels, icons, accents | | |
| Free-tier space links navigate | Click Defrag → /defrag | | |
| Pro-tier space shows lock on free account | Compression/Covenant show "Pro" badge | | |
| Ambient orbs visible | Background orb glow animates | | |

### 5.2 Defrag (Free, 3×/day limit)
| Test | Expected | Status | Notes |
|---|---|---|---|
| Landing page renders | Headline, CTA visible, green accent | | |
| Ask step: type name, submit | Transitions to thinking state | | |
| Thinking animation plays | Pulsing dots animate for ≥2s | | |
| Artifact renders | Dynamics + patterns + practice sections all populated | | |
| Restart works | Returns to landing | | |
| Daily limit (3rd run) | Warning badge appears | | |
| Daily limit (4th run) | Soft block with upgrade nudge | | |

### 5.3 Alignment (Free, 5×/day limit)
| Test | Expected | Status | Notes |
|---|---|---|---|
| Landing page renders | Headline, CTA, indigo accent | | |
| Textarea accepts input | Serif font, min 200 chars before submit enabled | | |
| Submit triggers thinking | Loading state appears | | |
| Artifact: 3 sections | Shift + Step + Question all present | | |
| Character count renders | Updates live as user types | | |

### 5.4 The Loop (Free, 3×/day limit)
| Test | Expected | Status | Notes |
|---|---|---|---|
| Landing page renders | Amber accent, headline correct | | |
| Full flow: type → submit → artifact | Mirror + Reset practice + Gentle truth sections | | |
| Artifact copy — no clinical language | No "diagnose", "disorder", "symptom" etc. | | |

### 5.5 Compression (Pro-gated)
| Test | Expected | Status | Notes |
|---|---|---|---|
| Free-tier user sees upgrade wall | SubscriptionGate renders, upgrade CTA shown | | |
| Pro-tier user: landing renders | Pink accent, massive textarea | | |
| Text dissolve animation | Input fades away on submit | | |
| Single truth sentence renders | Calm, short, non-clinical sentence | | |

### 5.6 Covenant (Pro-gated)
| Test | Expected | Status | Notes |
|---|---|---|---|
| Free-tier user sees upgrade wall | SubscriptionGate renders, upgrade CTA shown | | |
| Pro-tier user: landing renders | Gold accent, full flow accessible | | |
| Artifact: 3 sections | Scripture + Parallel + Step all present | | |
| No literal Scripture quotation in prompt | AI output uses paraphrase / reference | | |

---

## 6. Subscription & Billing

| Test | Expected | Status | Notes |
|---|---|---|---|
| /billing renders all 3 plan cards | Free / Pro / Enterprise visible | | |
| Current plan highlighted | User's active plan shows "Your current plan" | | |
| Upgrade CTA → Stripe checkout | Redirects to Stripe-hosted page | | |
| Stripe webhook: checkout.session.completed | User tier updated in Supabase, webhook_events recorded | | |
| Stripe webhook: customer.subscription.deleted | User downgraded to free tier | | |
| Idempotency: duplicate webhook | Second call returns 200, no duplicate DB writes | | |

---

## 7. PWA & Offline

| Test | Expected | Status | Notes |
|---|---|---|---|
| Add to home screen (iOS Safari) | App icon, standalone mode, no browser chrome | | |
| Add to home screen (Android Chrome) | Install prompt, app icon | | |
| Offline: cached pages load | Launcher page loads from cache | | |
| Offline: API call queued | Error state shown, queued to localStorage | | |
| Service worker update | On new deploy, SW updates on next visit | | |

---

## 8. Accessibility

| Test | Expected | Status | Notes |
|---|---|---|---|
| Keyboard navigation | All interactive elements reachable via Tab | | |
| Focus indicators | Visible focus ring on all inputs/buttons | | |
| Screen reader — headings | Logical heading hierarchy (h1 → h2 → h3) | | |
| Color contrast (Chrome & Bone) | Bone on #080808 ≥ 7:1 (WCAG AAA) | | |
| Touch targets | Min 44×44px on mobile | | |
| Reduced motion | Animations respect prefers-reduced-motion | | |

---

## 9. Copy / Brand Compliance

- [ ] No word "generate" in any user-facing string
- [ ] No clinical language: diagnose, disorder, symptom, pathology, mental illness
- [ ] No backend/system jargon: PostgREST, pgvector, RAG, schema, API
- [ ] Empathetic, warm tone throughout
- [ ] Serif font (Playfair Display) used for key headings
- [ ] All per-space accent colors match spec

---

## 10. Issues & Defects

| ID | Severity | Space | Description | Steps to Reproduce | Status |
|---|---|---|---|---|---|
| | | | | | |

**Severity:** P0 = blocker, P1 = critical, P2 = major, P3 = minor

---

## 11. Sign-off

| Role | Name | Signature | Date |
|---|---|---|---|
| QA Lead | | | |
| Engineering | | | |
| Product | | | |

**Deploy approved:** ☐ Yes ☐ No

---
*Template version 1.0 — SOVEREIGN.OS*
