/**
 * SubscriptionGate — SOVEREIGN.OS
 * Wraps any space content. If the user's tier doesn't meet the space requirement,
 * renders a premium upgrade wall instead of the children.
 */
import React from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { canAccessSpace, getUpgradePrompt, getTierForSpace, TIERS } from "../lib/subscription";
import type { SpaceId, Tier } from "../lib/subscription";

interface Props {
  spaceId: SpaceId;
  accent?: string;
  children: React.ReactNode;
}

// In production this comes from the session / Supabase profile.
// During SSR / no-session it falls back to "free".
function useUserTier(): Tier {
  const { data: session } = useSession();
  // @ts-ignore — extended session type from NextAuth config
  return (session?.user?.tier as Tier) ?? "free";
}

export default function SubscriptionGate({ spaceId, accent = "#818cf8", children }: Props) {
  const { data: session, status } = useSession();
  const userTier = useUserTier();

  // Loading state
  if (status === "loading") {
    return (
      <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="skeleton" style={{ width: 200, height: 24, borderRadius: 12 }} />
      </div>
    );
  }

  // Unauthenticated — soft gate (they may still be on free tier which is fine for some spaces)
  if (!session && getTierForSpace(spaceId) !== "free") {
    return <UpgradeWall spaceId={spaceId} accent={accent} reason="auth" />;
  }

  // Authenticated but insufficient tier
  if (session && !canAccessSpace(spaceId, userTier)) {
    return <UpgradeWall spaceId={spaceId} accent={accent} reason="tier" userTier={userTier} />;
  }

  return <>{children}</>;
}

// ─── Upgrade Wall ─────────────────────────────────────────────────────────────

function UpgradeWall({
  spaceId,
  accent,
  reason,
  userTier,
}: {
  spaceId: SpaceId;
  accent: string;
  reason: "auth" | "tier";
  userTier?: Tier;
}) {
  const { headline, sub } = getUpgradePrompt(spaceId);
  const requiredTier = getTierForSpace(spaceId);
  const tierConfig = TIERS[requiredTier];

  return (
    <>
      <style>{`
        .gate-root{min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:80px 24px;text-align:center;background:#080808;}
        .gate-badge{display:inline-flex;align-items:center;gap:8px;padding:6px 16px;border-radius:100px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);font-size:12px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;margin-bottom:32px;}
        .gate-card{max-width:480px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.08);border-radius:24px;padding:56px 40px;margin:0 auto;}
        @media(max-width:640px){.gate-card{padding:36px 24px;}}
        .gate-icon{width:64px;height:64px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:26px;margin:0 auto 28px;}
        .gate-h{font-family:var(--font-serif);font-size:clamp(22px,4vw,30px);color:var(--bone);font-weight:700;line-height:1.2;margin-bottom:14px;}
        .gate-sub{font-size:16px;color:var(--chrome-2);line-height:1.65;margin-bottom:36px;}
        .gate-features{list-style:none;padding:0;margin:0 0 36px;display:flex;flex-direction:column;gap:10px;text-align:left;}
        .gate-feat{display:flex;align-items:flex-start;gap:10px;font-size:14px;color:var(--chrome);}
        .gate-feat-icon{flex-shrink:0;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;margin-top:1px;}
        .gate-price{font-size:13px;color:var(--chrome-3);margin-bottom:20px;}
        .gate-price strong{font-size:28px;color:var(--bone);font-family:var(--font-serif);}
      `}</style>
      <div className="gate-root">
        <div className="orb orb-center" style={{ background: `radial-gradient(circle, ${accent}15, transparent 70%)` }} />
        <div className="gate-card fade-up">
          <div className="gate-icon" style={{ background: `${accent}15`, border: `1px solid ${accent}30` }}>
            <span style={{ color: accent }}>✦</span>
          </div>
          <div className="gate-badge" style={{ color: accent, borderColor: `${accent}30`, background: `${accent}10` }}>
            {tierConfig.label} feature
          </div>
          <h2 className="gate-h">{headline}</h2>
          <p className="gate-sub">{sub}</p>

          <ul className="gate-features">
            {PRO_FEATURES.map((f) => (
              <li key={f} className="gate-feat">
                <span className="gate-feat-icon" style={{ background: `${accent}15`, color: accent }}>✓</span>
                {f}
              </li>
            ))}
          </ul>

          <p className="gate-price">
            From <strong>${tierConfig.price.annual}</strong> / month, billed annually
          </p>

          <Link href={`/billing?upgrade=${requiredTier}`} className="btn btn-primary btn-full btn-lg"
            style={{ background: accent, color: "#080808", fontWeight: 700, marginBottom: 12 }}>
            Upgrade to {tierConfig.label}
          </Link>
          <Link href="/launcher" className="btn btn-ghost btn-full" style={{ fontSize: 14 }}>
            Back to spaces
          </Link>

          {reason === "tier" && userTier && (
            <p className="t-tiny t-muted" style={{ marginTop: 20 }}>
              You are currently on the {TIERS[userTier].label} plan.
            </p>
          )}
        </div>
      </div>
    </>
  );
}

const PRO_FEATURES = [
  "Unlimited runs across all six spaces",
  "Compression — pour out anything, find the one truth",
  "Covenant — scripture-grounded relationship wisdom",
  "90-day session history",
  "Streaming responses",
];
