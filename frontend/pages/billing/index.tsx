import React, { useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useSession, signIn } from "next-auth/react";
import { TIERS, SPACES, getUsageLimits } from "../../lib/subscription";
import type { Tier } from "../../lib/subscription";

const STRIPE_LINKS: Record<Tier, string> = {
  free: "#",
  pro: process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO ?? "#",
  enterprise: process.env.NEXT_PUBLIC_STRIPE_PRICE_ENTERPRISE ?? "#",
};

function PlanCard({ tier, current, accent }: { tier: Tier; current: boolean; accent: string }) {
  const cfg = TIERS[tier];
  const limits = getUsageLimits(tier);
  const proSpaces = SPACES.filter((s) => s.requiredTier === "pro");

  const features: string[] = {
    free: [
      "Launcher + Defrag + Alignment + The Loop",
      "Up to 3 sessions per day per space",
      "7-day session history",
      "Mobile PWA with home screen icon",
    ],
    pro: [
      "All six spaces — unlimited sessions",
      "Compression + Covenant unlocked",
      "90-day session history",
      "Streaming responses",
      "Priority support",
    ],
    enterprise: [
      "Everything in Pro",
      "365-day session history",
      "Priority queue — fastest responses",
      "API access for teams",
      "Dedicated onboarding",
    ],
  }[tier];

  return (
    <div className={`plan-card${current ? " plan-card--current" : ""}`} style={{ "--accent": accent } as React.CSSProperties}>
      <div className="plan-tier-badge" style={{ color: accent, borderColor: `${accent}40`, background: `${accent}10` }}>
        {cfg.label}
      </div>
      <div className="plan-price">
        {cfg.price.monthly === 0 ? (
          <span className="plan-price-num">Free</span>
        ) : (
          <>
            <span className="plan-price-num">${cfg.price.annual}</span>
            <span className="plan-price-per">/mo · billed annually</span>
          </>
        )}
      </div>
      <p className="plan-desc">{cfg.description}</p>
      <ul className="plan-features">
        {features.map((f) => (
          <li key={f}><span className="plan-check" style={{ color: accent }}>✓</span>{f}</li>
        ))}
      </ul>
      {current ? (
        <div className="btn btn-ghost btn-full" style={{ opacity: 0.5, cursor: "default", pointerEvents: "none" }}>
          Your current plan
        </div>
      ) : (
        <a
          href={tier === "free" ? "#" : `/api/billing/checkout?tier=${tier}`}
          className="btn btn-primary btn-full"
          style={{ background: accent, color: "#080808", fontWeight: 700 }}
        >
          {tier === "free" ? "Downgrade to Free" : `Upgrade to ${cfg.label}`}
        </a>
      )}
    </div>
  );
}

export default function Billing() {
  const { data: session } = useSession();
  // @ts-ignore
  const userTier: Tier = (session?.user?.tier as Tier) ?? "free";

  return (
    <>
      <Head>
        <title>Plans & Billing — SOVEREIGN</title>
        <meta name="description" content="Choose the plan that fits your journey." />
      </Head>
      <style>{`
        .billing-root{min-height:100dvh;background:radial-gradient(ellipse 70% 50% at 50% 0%,rgba(129,140,248,0.07),#080808 55%);padding-bottom:80px;}
        .billing-hero{text-align:center;padding:120px 24px 60px;}
        .billing-h{font-family:var(--font-serif);font-size:clamp(32px,5vw,52px);color:var(--bone);font-weight:700;line-height:1.1;margin-bottom:14px;letter-spacing:-0.03em;}
        .billing-sub{font-size:18px;color:var(--chrome-2);max-width:420px;margin:0 auto;}
        .plans-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px;max-width:980px;margin:0 auto;padding:0 24px;}
        .plan-card{background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.08);border-radius:20px;padding:36px 32px;display:flex;flex-direction:column;gap:0;transition:border-color .2s,transform .2s;}
        .plan-card:hover{border-color:rgba(255,255,255,0.14);transform:translateY(-2px);}
        .plan-card--current{border-color:rgba(129,140,248,0.35);background:rgba(129,140,248,0.04);}
        .plan-tier-badge{display:inline-flex;align-items:center;padding:4px 12px;border-radius:100px;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;border:1px solid;width:fit-content;margin-bottom:20px;}
        .plan-price{margin-bottom:8px;}
        .plan-price-num{font-family:var(--font-serif);font-size:42px;color:var(--bone);font-weight:700;line-height:1;}
        .plan-price-per{font-size:13px;color:var(--chrome-3);margin-left:4px;}
        .plan-desc{font-size:14px;color:var(--chrome-3);margin-bottom:24px;padding-bottom:24px;border-bottom:1px solid rgba(255,255,255,0.06);}
        .plan-features{list-style:none;padding:0;margin:0 0 28px;display:flex;flex-direction:column;gap:10px;flex:1;}
        .plan-features li{display:flex;align-items:flex-start;gap:8px;font-size:14px;color:var(--chrome);line-height:1.5;}
        .plan-check{flex-shrink:0;font-weight:700;margin-top:1px;}
        .compare-section{max-width:760px;margin:60px auto 0;padding:0 24px;}
        .compare-h{font-family:var(--font-serif);font-size:22px;color:var(--bone);margin-bottom:24px;text-align:center;}
        .compare-table{width:100%;border-collapse:collapse;}
        .compare-table th,.compare-table td{padding:12px 16px;text-align:left;border-bottom:1px solid rgba(255,255,255,0.06);font-size:14px;}
        .compare-table th{color:var(--chrome-3);font-weight:600;font-size:12px;letter-spacing:.06em;text-transform:uppercase;}
        .compare-table td{color:var(--chrome);}
        .compare-table td:first-child{color:var(--bone);font-weight:500;}
      `}</style>

      <div className="billing-root">
        <nav className="nav"><div className="nav-inner">
          <Link href="/launcher" className="nav-back">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Back
          </Link>
          <span className="nav-wordmark">Plans</span>
        </div></nav>

        <div className="billing-hero">
          <h1 className="billing-h">Choose your journey.</h1>
          <p className="billing-sub">Start free. Upgrade when you are ready for more.</p>
        </div>

        <div className="plans-grid">
          <PlanCard tier="free" current={userTier === "free"} accent="#c8c8c8" />
          <PlanCard tier="pro" current={userTier === "pro"} accent="#818cf8" />
          <PlanCard tier="enterprise" current={userTier === "enterprise"} accent="#d97706" />
        </div>

        <div className="compare-section fade-up">
          <h2 className="compare-h">Everything in one view</h2>
          <table className="compare-table">
            <thead>
              <tr>
                <th>Space</th>
                <th>Free</th>
                <th>Pro</th>
                <th>Enterprise</th>
              </tr>
            </thead>
            <tbody>
              {SPACES.map((s) => (
                <tr key={s.id}>
                  <td>{s.icon} {s.label}</td>
                  <td>{s.requiredTier === "free" ? (s.dailyLimit ? `${s.dailyLimit}×/day` : "✓") : "—"}</td>
                  <td>✓ Unlimited</td>
                  <td>✓ Priority</td>
                </tr>
              ))}
              <tr><td>Session history</td><td>7 days</td><td>90 days</td><td>365 days</td></tr>
              <tr><td>Streaming responses</td><td>—</td><td>✓</td><td>✓</td></tr>
              <tr><td>API access</td><td>—</td><td>—</td><td>✓</td></tr>
            </tbody>
          </table>
          <p style={{ textAlign: "center", fontSize: 13, color: "var(--chrome-3)", marginTop: 24 }}>
            All plans include end-to-end encryption, full data privacy, and the ability to delete your data at any time.
          </p>
        </div>
      </div>
    </>
  );
}
