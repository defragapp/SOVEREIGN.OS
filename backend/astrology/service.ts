/**
 * backend/astrology/service.ts
 * Astrology overlay service — computes natal charts and daily transits,
 * then synthesises interpretations via the AI Switchboard Worker.
 */

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const WORKER_URL = process.env.WORKER_URL ?? "https://api.sovereign.os";

// ─── Planet data (simplified Swiss Ephemeris-compatible structure) ─────────────

export type ZodiacSign =
  | "Aries" | "Taurus" | "Gemini" | "Cancer" | "Leo" | "Virgo"
  | "Libra" | "Scorpio" | "Sagittarius" | "Capricorn" | "Aquarius" | "Pisces";

export interface PlanetPosition {
  planet: string;
  sign: ZodiacSign;
  degree: number;
  house: number;
  retrograde: boolean;
}

export interface NatalChart {
  sun: PlanetPosition;
  moon: PlanetPosition;
  mercury: PlanetPosition;
  venus: PlanetPosition;
  mars: PlanetPosition;
  jupiter: PlanetPosition;
  saturn: PlanetPosition;
  ascendant: ZodiacSign;
  midheaven: ZodiacSign;
  computed_at: string;
}

export interface TransitData {
  date: string;
  active_transits: Array<{
    planet: string;
    aspect: string;
    natal_point: string;
    orb: number;
    energy: "harmonious" | "challenging" | "neutral";
    theme: string;
  }>;
  moon_phase: string;
  dominant_energy: string;
}

// ─── Natal chart computation ───────────────────────────────────────────────────
// NOTE: In production, replace with a call to a Swiss Ephemeris microservice
// or the `astronomia` npm package. This returns a deterministic mock for CI.

export function computeNatalChart(
  birthDate: string,   // ISO date e.g. "1993-07-15"
  birthPlace: string,  // "Los Angeles, CA" — resolve to lat/lng via geocoding API
  birthTime?: string   // "14:30" — optional, improves house calculation
): NatalChart {
  const seed = birthDate.replace(/-/g, "");
  const signs: ZodiacSign[] = [
    "Aries","Taurus","Gemini","Cancer","Leo","Virgo",
    "Libra","Scorpio","Sagittarius","Capricorn","Aquarius","Pisces"
  ];
  const pick = (offset: number): ZodiacSign => signs[(parseInt(seed.slice(0, 2)) + offset) % 12];

  return {
    sun:       { planet: "Sun",     sign: pick(0),  degree: 15.3, house: 5,  retrograde: false },
    moon:      { planet: "Moon",    sign: pick(3),  degree: 8.7,  house: 8,  retrograde: false },
    mercury:   { planet: "Mercury", sign: pick(1),  degree: 22.1, house: 5,  retrograde: false },
    venus:     { planet: "Venus",   sign: pick(2),  degree: 4.9,  house: 4,  retrograde: false },
    mars:      { planet: "Mars",    sign: pick(7),  degree: 11.4, house: 10, retrograde: false },
    jupiter:   { planet: "Jupiter", sign: pick(9),  degree: 29.0, house: 12, retrograde: true  },
    saturn:    { planet: "Saturn",  sign: pick(10), degree: 17.6, house: 1,  retrograde: false },
    ascendant: pick(4),
    midheaven: pick(1),
    computed_at: new Date().toISOString(),
  };
}

// ─── Daily transit computation ─────────────────────────────────────────────────

export function computeDailyTransits(natal: NatalChart, date: Date = new Date()): TransitData {
  const dayOfYear = Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86400000);
  const moonPhases = ["New Moon", "Waxing Crescent", "First Quarter", "Waxing Gibbous",
                      "Full Moon", "Waning Gibbous", "Last Quarter", "Waning Crescent"];

  return {
    date: date.toISOString().slice(0, 10),
    active_transits: [
      {
        planet: "Jupiter",
        aspect: "trine",
        natal_point: `natal ${natal.sun.sign} Sun`,
        orb: 1.2,
        energy: "harmonious",
        theme: "Expansion, opportunity, and optimism amplify creative expression.",
      },
      {
        planet: "Saturn",
        aspect: "square",
        natal_point: `natal ${natal.moon.sign} Moon`,
        orb: 2.8,
        energy: "challenging",
        theme: "Emotional discipline required; restructuring brings long-term stability.",
      },
    ],
    moon_phase: moonPhases[dayOfYear % 8],
    dominant_energy: dayOfYear % 2 === 0 ? "harmonious" : "reflective",
  };
}

// ─── AI synthesis ─────────────────────────────────────────────────────────────

export async function synthesiseAstroOverlay(
  userId: string,
  natal: NatalChart,
  transits: TransitData
): Promise<string> {
  const prompt = `
You are SOVEREIGN ASTRO SYNTHESISER — a sophisticated interpreter of astrological energies.
Do not use the word "generate". Speak as an insightful guide revealing patterns.

NATAL CHART SUMMARY:
- Sun in ${natal.sun.sign} (House ${natal.sun.house})
- Moon in ${natal.moon.sign} (House ${natal.moon.house})
- Ascendant: ${natal.ascendant}
- Midheaven: ${natal.midheaven}

TODAY'S ACTIVE TRANSITS (${transits.date}):
${transits.active_transits.map(t =>
  `- ${t.planet} ${t.aspect} ${t.natal_point} [${t.energy}]: ${t.theme}`
).join("\n")}
Moon Phase: ${transits.moon_phase}

Craft a 3-paragraph personalised daily synthesis:
1. The dominant cosmic theme for today and how it interfaces with this person's natal blueprint.
2. A specific area of life most activated (career, relationships, inner world, creativity, healing).
3. A grounded, actionable invitation for the day — practical and poetic.
  `.trim();

  const response = await fetch(`${WORKER_URL}/dispatch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      operation: "compression",
      payload: {
        session_id: crypto.randomUUID(),
        content: prompt,
        target_ratio: 0.95, // near-full output — just using compression as a pass-through
        format: "summary",
      },
    }),
  });

  if (!response.ok) throw new Error("AI synthesis failed");
  const data = await response.json() as { compressed_content: string };
  return data.compressed_content;
}

// ─── Full overlay pipeline ────────────────────────────────────────────────────

export async function getOrCreateAstroOverlay(userId: string): Promise<{
  natal: NatalChart;
  transits: TransitData;
  synthesis: string;
  cached: boolean;
}> {
  // Check cache (valid for 24h)
  const { data: cached } = await supabase
    .from("astrology_overlays")
    .select("*")
    .eq("user_id", userId)
    .gt("expires_at", new Date().toISOString())
    .order("generated_at", { ascending: false })
    .limit(1)
    .single();

  if (cached) {
    return {
      natal: cached.natal_chart as NatalChart,
      transits: cached.transit_data as TransitData,
      synthesis: cached.synthesis as string,
      cached: true,
    };
  }

  // Fetch user profile for birth data
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("birth_date, birth_place")
    .eq("id", userId)
    .single();

  const natal = computeNatalChart(
    profile?.birth_date ?? "1990-01-01",
    profile?.birth_place ?? "New York, NY"
  );
  const transits = computeDailyTransits(natal);
  const synthesis = await synthesiseAstroOverlay(userId, natal, transits);

  // Persist
  await supabase.from("astrology_overlays").insert({
    user_id: userId,
    natal_chart: natal,
    transit_data: transits,
    synthesis,
    generated_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  });

  return { natal, transits, synthesis, cached: false };
}
