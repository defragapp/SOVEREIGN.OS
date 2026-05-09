/**
 * SOVEREIGN.OS — Marketing Landing Page
 * Chrome & Bone design system. No clinical/system language.
 */
import React, { useEffect, useRef } from "react";
import Head from "next/head";
import Link from "next/link";
import { useSession } from "next-auth/react";

const SPACES = [
  { id: "defrag",      icon: "◈", label: "Defrag",      accent: "#10b981", tagline: "Relationship clarity", blurb: "See the patterns before they become arguments." },
  { id: "alignment",  icon: "⊕", label: "Alignment",   accent: "#818cf8", tagline: "Personal clarity",      blurb: "Find your center. Know your next right step." },
  { id: "loop",       icon: "↺", label: "The Loop",    accent: "#f59e0b", tagline: "Break the cycle",        blurb: "Stuck? Let us show you the way out." },
  { id: "compression",icon: "⊞", label: "Compression", accent: "#f472b6", tagline: "From overwhelm to calm", blurb: "Pour it all out. Receive one calming truth.", pro: true },
  { id: "covenant",   icon: "✦", label: "Covenant",    accent: "#d97706", tagline: "Biblical wisdom",        blurb: "Timeless guidance for today's relationships.", pro: true },
];

const TESTIMONIALS = [
  { text: "I used Alignment before the hardest conversation of my life. I felt calm, clear, and ready.", name: "M., Los Angeles" },
  { text: "Compression took three months of chaos and handed me back one sentence. I wept.", name: "T., Chicago" },
  { text: "The Loop finally showed me why I kept having the same fight. I had no idea.", name: "R., New York" },
];

export default function Landing() {
  const { data: session } = useSession();
  const heroRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    const handler = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width - 0.5) * 30;
      const y = ((e.clientY - rect.top)  / rect.height - 0.5) * 30;
      el.style.setProperty("--mx", `${x}px`);
      el.style.setProperty("--my", `${y}px`);
    };
    el.addEventListener("mousemove", handler);
    return () => el.removeEventListener("mousemove", handler);
  }, []);

  return (
    <>
      <Head>
        <title>SOVEREIGN — Clarity for yourself, and the people you care about.</title>
        <meta name="description" content="Six spaces. One purpose: clarity. SOVEREIGN is a premium platform for relationship insight, personal alignment, and timeless wisdom." />
        <meta property="og:title" content="SOVEREIGN — Clarity starts here." />
        <meta property="og:description" content="Six spaces. One purpose: clarity." />
        <meta property="og:image" content="/og-image.png" />
        <meta name="theme-color" content="#080808" />
      </Head>

      <style>{`
        /* ── Page Layout ───────────────────────────────────── */
        .land-root{background:#080808;min-height:100dvh;overflow-x:hidden;}

        /* ── Nav ───────────────────────────────────────────── */
        .land-nav{position:fixed;top:0;left:0;right:0;z-index:100;display:flex;align-items:center;justify-content:space-between;padding:20px 32px;background:rgba(8,8,8,0.7);backdrop-filter:blur(12px);border-bottom:1px solid rgba(255,255,255,0.05);}
        .land-logo{font-family:var(--font-serif);font-size:18px;font-weight:700;color:var(--bone);letter-spacing:.04em;}
        .land-nav-links{display:flex;align-items:center;gap:24px;}
        .land-nav-link{font-size:14px;color:var(--chrome-2);text-decoration:none;transition:color .2s;}
        .land-nav-link:hover{color:var(--bone);}
        @media(max-width:640px){.land-nav-links .land-nav-link:not(.land-cta){display:none;}}
        .land-cta{padding:8px 20px;border-radius:100px;background:var(--bone);color:#080808;font-weight:700;font-size:13px;text-decoration:none;transition:opacity .2s;}
        .land-cta:hover{opacity:.85;}

        /* ── Hero ──────────────────────────────────────────── */
        .land-hero{min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:120px 24px 80px;position:relative;--mx:0px;--my:0px;}
        .hero-orb-1{position:absolute;width:600px;height:600px;border-radius:50%;background:radial-gradient(circle,rgba(129,140,248,0.12),transparent 65%);top:10%;left:50%;transform:translate(calc(-50% + var(--mx)),var(--my));pointer-events:none;transition:transform .8s ease;}
        .hero-orb-2{position:absolute;width:400px;height:400px;border-radius:50%;background:radial-gradient(circle,rgba(16,185,129,0.08),transparent 65%);bottom:20%;right:10%;pointer-events:none;}
        .hero-overline{display:inline-flex;align-items:center;gap:8px;padding:6px 18px;border-radius:100px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);font-size:11px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:var(--chrome-2);margin-bottom:32px;}
        .hero-overline::before{content:'';width:6px;height:6px;border-radius:50%;background:#10b981;animation:pulse-dot 2s ease-in-out infinite;}
        @keyframes pulse-dot{0%,100%{opacity:1;transform:scale(1);}50%{opacity:.4;transform:scale(.8);}}
        .land-h1{font-family:var(--font-serif);font-size:clamp(40px,7vw,88px);font-weight:700;color:var(--bone);line-height:1.05;letter-spacing:-0.03em;max-width:900px;margin-bottom:24px;}
        .land-h1 em{font-style:normal;background:linear-gradient(135deg,#818cf8,#f472b6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;}
        .hero-sub{font-size:clamp(16px,2vw,20px);color:var(--chrome-2);max-width:520px;line-height:1.65;margin-bottom:44px;}
        .hero-actions{display:flex;flex-wrap:wrap;gap:12px;justify-content:center;}
        .btn-hero-primary{padding:14px 32px;border-radius:100px;background:var(--bone);color:#080808;font-weight:700;font-size:16px;text-decoration:none;transition:opacity .2s,transform .2s;}
        .btn-hero-primary:hover{opacity:.88;transform:translateY(-1px);}
        .btn-hero-ghost{padding:14px 32px;border-radius:100px;border:1px solid rgba(255,255,255,0.15);color:var(--chrome);font-size:16px;text-decoration:none;transition:border-color .2s,color .2s;}
        .btn-hero-ghost:hover{border-color:rgba(255,255,255,0.35);color:var(--bone);}
        .hero-trust{margin-top:52px;font-size:12px;color:var(--chrome-3);letter-spacing:.05em;}

        /* ── Spaces Grid ────────────────────────────────────── */
        .spaces-section{padding:100px 24px;max-width:1100px;margin:0 auto;}
        .section-label{font-size:11px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:var(--chrome-3);margin-bottom:16px;text-align:center;}
        .section-h{font-family:var(--font-serif);font-size:clamp(28px,4vw,44px);color:var(--bone);text-align:center;margin-bottom:14px;line-height:1.15;}
        .section-sub{font-size:17px;color:var(--chrome-2);text-align:center;max-width:480px;margin:0 auto 56px;line-height:1.6;}
        .spaces-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;}
        .space-tile{background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.07);border-radius:20px;padding:32px 28px;text-decoration:none;display:block;transition:border-color .25s,background .25s,transform .25s;position:relative;overflow:hidden;}
        .space-tile::after{content:'';position:absolute;inset:0;background:radial-gradient(circle at 80% 20%,var(--accent),transparent 60%);opacity:0;transition:opacity .3s;}
        .space-tile:hover{border-color:rgba(255,255,255,0.14);background:rgba(255,255,255,0.035);transform:translateY(-3px);}
        .space-tile:hover::after{opacity:.06;}
        .space-tile-icon{font-size:24px;margin-bottom:16px;display:block;}
        .space-tile-label{font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin-bottom:8px;}
        .space-tile-tagline{font-family:var(--font-serif);font-size:18px;color:var(--bone);margin-bottom:8px;line-height:1.3;}
        .space-tile-blurb{font-size:14px;color:var(--chrome-2);line-height:1.55;}
        .space-tile-pro{position:absolute;top:20px;right:20px;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;padding:3px 10px;border-radius:100px;}

        /* ── How It Works ───────────────────────────────────── */
        .how-section{padding:80px 24px;border-top:1px solid rgba(255,255,255,0.05);border-bottom:1px solid rgba(255,255,255,0.05);}
        .how-inner{max-width:800px;margin:0 auto;}
        .steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:40px;margin-top:52px;}
        .step-num{font-family:var(--font-serif);font-size:36px;font-weight:700;color:rgba(240,235,225,0.12);line-height:1;margin-bottom:12px;}
        .step-h{font-size:16px;font-weight:600;color:var(--bone);margin-bottom:8px;}
        .step-p{font-size:14px;color:var(--chrome-2);line-height:1.6;}

        /* ── Testimonials ────────────────────────────────────── */
        .test-section{padding:100px 24px;max-width:1000px;margin:0 auto;}
        .test-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px;margin-top:52px;}
        .test-card{background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.07);border-radius:16px;padding:28px 24px;}
        .test-quote{font-family:var(--font-serif);font-size:17px;color:var(--bone);line-height:1.6;margin-bottom:20px;font-style:italic;}
        .test-name{font-size:13px;color:var(--chrome-3);font-weight:600;}

        /* ── CTA ─────────────────────────────────────────────── */
        .cta-section{padding:120px 24px;text-align:center;position:relative;}
        .cta-orb{position:absolute;width:500px;height:500px;border-radius:50%;background:radial-gradient(circle,rgba(129,140,248,0.1),transparent 65%);top:50%;left:50%;transform:translate(-50%,-50%);pointer-events:none;}
        .cta-h{font-family:var(--font-serif);font-size:clamp(32px,5vw,60px);color:var(--bone);line-height:1.1;letter-spacing:-0.02em;margin-bottom:20px;max-width:700px;margin-left:auto;margin-right:auto;}
        .cta-sub{font-size:17px;color:var(--chrome-2);margin-bottom:40px;}

        /* ── Footer ──────────────────────────────────────────── */
        .land-footer{padding:32px;border-top:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;}
        .footer-logo{font-family:var(--font-serif);font-size:15px;color:var(--chrome-3);}
        .footer-links{display:flex;gap:20px;}
        .footer-link{font-size:13px;color:var(--chrome-3);text-decoration:none;transition:color .2s;}
        .footer-link:hover{color:var(--bone);}
      `}</style>

      <div className="land-root">
        {/* Nav */}
        <nav className="land-nav">
          <span className="land-logo">SOVEREIGN</span>
          <div className="land-nav-links">
            <a href="#spaces" className="land-nav-link">Spaces</a>
            <a href="#how" className="land-nav-link">How it works</a>
            <Link href="/billing" className="land-nav-link">Plans</Link>
            {session ? (
              <Link href="/launcher" className="land-cta">Open app →</Link>
            ) : (
              <Link href="/auth/signin" className="land-cta">Begin →</Link>
            )}
          </div>
        </nav>

        {/* Hero */}
        <section className="land-hero fade-up" ref={heroRef}>
          <div className="hero-orb-1" />
          <div className="hero-orb-2" />
          <div className="hero-overline">Now available</div>
          <h1 className="land-h1">
            Clarity for yourself,<br />and the people<br />you <em>care about.</em>
          </h1>
          <p className="hero-sub">
            Six spaces. One purpose. SOVEREIGN helps you understand yourself, your relationships, and the moments that shape both.
          </p>
          <div className="hero-actions">
            <Link href={session ? "/launcher" : "/auth/signin"} className="btn-hero-primary">
              {session ? "Open your spaces →" : "Begin for free →"}
            </Link>
            <a href="#spaces" className="btn-hero-ghost">Explore spaces</a>
          </div>
          <p className="hero-trust">No card required · Free to start · Private by design</p>
        </section>

        {/* Spaces */}
        <section className="spaces-section fade-up" id="spaces">
          <p className="section-label">Six spaces</p>
          <h2 className="section-h">A space for every kind of clarity.</h2>
          <p className="section-sub">Each space holds a different kind of insight. Choose where you need to begin.</p>
          <div className="spaces-grid">
            {SPACES.map((s) => (
              <Link key={s.id} href={session ? `/${s.id}` : "/auth/signin"} className="space-tile"
                style={{ "--accent": s.accent } as React.CSSProperties}>
                {s.pro && (
                  <span className="space-tile-pro"
                    style={{ background: `${s.accent}15`, color: s.accent, border: `1px solid ${s.accent}40` }}>
                    Pro
                  </span>
                )}
                <span className="space-tile-icon" style={{ color: s.accent }}>{s.icon}</span>
                <div className="space-tile-label" style={{ color: s.accent }}>{s.tagline}</div>
                <div className="space-tile-tagline">{s.label}</div>
                <div className="space-tile-blurb">{s.blurb}</div>
              </Link>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section className="how-section" id="how">
          <div className="how-inner">
            <p className="section-label" style={{ textAlign: "center" }}>How it works</p>
            <h2 className="section-h">Arrive with a question.<br />Leave with clarity.</h2>
            <div className="steps">
              {[
                { n: "01", h: "Choose a space", p: "Each space holds a different kind of question. Start wherever you feel pulled." },
                { n: "02", h: "Share what's on your mind", p: "A single gentle prompt. No forms, no categories — just your words." },
                { n: "03", h: "Receive something real", p: "A crafted insight, a shift, a practice. Not advice — understanding." },
              ].map((s) => (
                <div key={s.n}>
                  <div className="step-num">{s.n}</div>
                  <div className="step-h">{s.h}</div>
                  <p className="step-p">{s.p}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Testimonials */}
        <section className="test-section fade-up">
          <p className="section-label">What people say</p>
          <h2 className="section-h">Real moments. Real clarity.</h2>
          <div className="test-grid">
            {TESTIMONIALS.map((t) => (
              <div key={t.name} className="test-card">
                <p className="test-quote">"{t.text}"</p>
                <p className="test-name">— {t.name}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="cta-section fade-up">
          <div className="cta-orb" />
          <h2 className="cta-h">The space you've been looking for has always been here.</h2>
          <p className="cta-sub">Free to begin. No credit card. No commitment.</p>
          <Link href={session ? "/launcher" : "/auth/signin"} className="btn-hero-primary">
            {session ? "Go to your spaces →" : "Begin for free →"}
          </Link>
        </section>

        {/* Footer */}
        <footer className="land-footer">
          <span className="footer-logo">SOVEREIGN</span>
          <div className="footer-links">
            <Link href="/billing" className="footer-link">Plans</Link>
            <a href="mailto:hello@sovereign.os" className="footer-link">Contact</a>
            <a href="/privacy" className="footer-link">Privacy</a>
            <a href="/terms" className="footer-link">Terms</a>
          </div>
        </footer>
      </div>
    </>
  );
}
