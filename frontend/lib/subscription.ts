/**
 * Subscription tier logic — SOVEREIGN.OS
 * Maps spaces to required tiers, usage limits, and feature flags.
 * All pricing/tier data is read-only here; mutations go through Stripe webhooks.
 */

export type Tier = "free" | "pro" | "enterprise";
export type SpaceId = "launcher" | "defrag" | "alignment" | "loop" | "compression" | "covenant";

export interface TierConfig {
  tier: Tier;
  label: string;
  price: { monthly: number; annual: number };
  color: string;
  description: string;
}

export interface SpaceConfig {
  id: SpaceId;
  label: string;
  accent: string;
  href: string;
  requiredTier: Tier;
  dailyLimit: number | null; // null = unlimited
  icon: string;
  tagline: string;
  description: string;
}

export interface UsageLimits {
  dailyRuns: number | null;
  streamingEnabled: boolean;
  historyDays: number;
  priorityQueue: boolean;
  apiAccess: boolean;
}

// ─── Tier Definitions ────────────────────────────────────────────────────────

export const TIERS: Record<Tier, TierConfig> = {
  free: {
    tier: "free",
    label: "Essential",
    price: { monthly: 0, annual: 0 },
    color: "#c8c8c8",
    description: "Begin your journey",
  },
  pro: {
    tier: "pro",
    label: "Pro",
    price: { monthly: 19, annual: 14 },
    color: "#818cf8",
    description: "Full access to every space",
  },
  enterprise: {
    tier: "enterprise",
    label: "Enterprise",
    price: { monthly: 99, annual: 79 },
    color: "#d97706",
    description: "Priority access + API",
  },
};

// ─── Space Definitions ────────────────────────────────────────────────────────

export const SPACES: SpaceConfig[] = [
  {
    id: "launcher",
    label: "Launcher",
    accent: "#c8c8c8",
    href: "/launcher",
    requiredTier: "free",
    dailyLimit: null,
    icon: "◎",
    tagline: "Your personal sanctuary",
    description: "Clarity for yourself, and the people you care about.",
  },
  {
    id: "defrag",
    label: "Defrag",
    accent: "#10b981",
    href: "/defrag",
    requiredTier: "free",
    dailyLimit: 3,
    icon: "◈",
    tagline: "Understanding Relationships",
    description: "See the patterns before they become arguments.",
  },
  {
    id: "alignment",
    label: "Alignment",
    accent: "#818cf8",
    href: "/alignment",
    requiredTier: "free",
    dailyLimit: 5,
    icon: "⊕",
    tagline: "Personal Clarity",
    description: "Find your center. Know your next right step.",
  },
  {
    id: "loop",
    label: "The Loop",
    accent: "#f59e0b",
    href: "/loop",
    requiredTier: "free",
    dailyLimit: 3,
    icon: "↺",
    tagline: "Breaking the Cycle",
    description: "Stuck in a loop? Let us show you the way out.",
  },
  {
    id: "compression",
    label: "Compression",
    accent: "#f472b6",
    href: "/compression",
    requiredTier: "pro",
    dailyLimit: null,
    icon: "⊞",
    tagline: "From Overwhelm to Clarity",
    description: "From overwhelm to absolute clarity in seconds.",
  },
  {
    id: "covenant",
    label: "Covenant",
    accent: "#d97706",
    href: "/covenant",
    requiredTier: "pro",
    dailyLimit: null,
    icon: "✦",
    tagline: "Biblical Wisdom",
    description: "Timeless wisdom for today's relationships.",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TIER_RANK: Record<Tier, number> = { free: 0, pro: 1, enterprise: 2 };

/** Returns true if the user's current tier meets or exceeds the required tier. */
export function canAccessSpace(spaceId: SpaceId, userTier: Tier): boolean {
  const space = SPACES.find((s) => s.id === spaceId);
  if (!space) return false;
  return TIER_RANK[userTier] >= TIER_RANK[space.requiredTier];
}

/** Returns the tier required for a specific space. */
export function getTierForSpace(spaceId: SpaceId): Tier {
  return SPACES.find((s) => s.id === spaceId)?.requiredTier ?? "free";
}

/** Returns usage limits for a given tier. */
export function getUsageLimits(tier: Tier): UsageLimits {
  switch (tier) {
    case "free":
      return {
        dailyRuns: 3,
        streamingEnabled: false,
        historyDays: 7,
        priorityQueue: false,
        apiAccess: false,
      };
    case "pro":
      return {
        dailyRuns: null,
        streamingEnabled: true,
        historyDays: 90,
        priorityQueue: false,
        apiAccess: false,
      };
    case "enterprise":
      return {
        dailyRuns: null,
        streamingEnabled: true,
        historyDays: 365,
        priorityQueue: true,
        apiAccess: true,
      };
  }
}

/** Get per-space daily run limit for a tier (space-specific override takes precedence). */
export function getDailyLimit(spaceId: SpaceId, tier: Tier): number | null {
  if (tier === "pro" || tier === "enterprise") return null;
  const space = SPACES.find((s) => s.id === spaceId);
  return space?.dailyLimit ?? getUsageLimits(tier).dailyRuns;
}

/** Returns upgrade messaging for a space when user is on insufficient tier. */
export function getUpgradePrompt(spaceId: SpaceId): { headline: string; sub: string } {
  const space = SPACES.find((s) => s.id === spaceId);
  const maps: Partial<Record<SpaceId, { headline: string; sub: string }>> = {
    compression: {
      headline: "Clear the noise with Pro.",
      sub: "Compression is available to Pro members. Upgrade to distil any amount of overwhelm into a single, calming truth.",
    },
    covenant: {
      headline: "Unlock timeless wisdom with Pro.",
      sub: "Covenant is available to Pro members. Upgrade for scripture-grounded guidance for every relationship in your life.",
    },
  };
  return (
    maps[spaceId] ?? {
      headline: `Unlock ${space?.label ?? "this space"} with Pro.`,
      sub: "Upgrade your plan to access this space and everything Sovereign has to offer.",
    }
  );
}
