import React, { useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useSession, signIn } from "next-auth/react";
import { dispatch, WorkerUnavailableError } from "../../lib/worker-client";

type Phase = "landing"|"ask"|"thinking"|"result"|"queued"|"error";

interface Result { synthesis: string; patterns: string[]; practice: string; }

export default function Defrag() {
  const { data: session } = useSession();
  const [phase, setPhase] = useState<Phase>("landing");
  const [who, setWho] = useState("");
  const [situation, setSituation] = useState("");
  const [result, setResult] = useState<Result|null>(null);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!session) { signIn(); return; }
    if (!who.trim()) return;
    setPhase("thinking");

    const prompt = `I'm trying to understand how to better connect with ${who}. Here's what's happening: ${situation || "I want to understand their patterns and communicate better."}`;

    try {
      const data = await dispatch<{ reasoning: string; recommendations: string[] }>({
        operation: "alignment",
        payload: {
          session_id: crypto.randomUUID(),
          agent_id: "defrag-agent",
          prompt: `You are SOVEREIGN DEFRAG — a compassionate relationship guide. Do not use clinical terms. Speak with warmth and clarity.\n\nA person wants to connect better with: ${who}\nSituation: ${situation || "general communication improvement"}\n\nProvide:\n1. A warm, 2-sentence insight into the relationship dynamic and how each person processes differently\n2. Two specific communication patterns to notice (empathetic, non-judgmental)\n3. One simple practice they can try today\n\nBe human, warm, and practical. Avoid jargon.`,
          temperature: 0.7,
          stream: false,
        },
      });
      const lines = data.reasoning.split("\n").filter(Boolean);
      setResult({
        synthesis: lines.slice(0, 2).join(" "),
        patterns: data.recommendations.slice(0, 2),
        practice: lines[lines.length - 1] ?? "Take a breath before responding, and ask one curious question.",
      });
      setPhase("result");
    } catch (err) {
      if (err instanceof WorkerUnavailableError) { setPhase("queued"); return; }
      setError("Something shifted. Try again in a moment."); setPhase("error");
    }
  }

  return (
    <>
      <Head>
        <title>Defrag — SOVEREIGN</title>
        <meta name="description" content="See the patterns before they become arguments." />
        <meta name="theme-color" content="#0a1a14" />
      </Head>

      <style>{`
        .df-root { min-height:100dvh; background:radial-gradient(ellipse 80% 60% at 50% 0%, rgba(16,185,129,0.08) 0%, #080808 60%); }
        .df-hero { min-height:100dvh; display:flex;flex-direction:column;align-items:center;justify-content:center; padding:80px 24px 60px; text-align:center; }
        .df-badge { display:inline-flex;align-items:center;gap:8px;padding:6px 16px;border-radius:100px;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.25);font-size:12px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#10b981;margin-bottom:28px; }
        .df-h1 { font-family:var(--font-serif);font-size:clamp(36px,7vw,72px);font-weight:700;line-height:1.05;letter-spacing:-0.03em;color:var(--bone);margin-bottom:20px;max-width:720px; }
        .df-sub { font-size:clamp(16px,2vw,19px);color:var(--chrome-2);line-height:1.65;max-width:480px;margin:0 auto 44px; }
        .df-form-wrap { width:100%;max-width:560px;margin:0 auto; }
        .df-form { display:flex;flex-direction:column;gap:14px;width:100%; }
        .df-label { font-size:13px;font-weight:600;color:var(--chrome-3);letter-spacing:.04em;margin-bottom:4px;display:block; }
        .df-thinking { display:flex;flex-direction:column;align-items:center;gap:24px;padding:80px 24px;text-align:center; }
        .df-thinking-ring { width:64px;height:64px;border-radius:50%;border:2px solid rgba(16,185,129,0.2);border-top-color:#10b981;animation:spin 1s linear infinite; }
        .df-result { max-width:640px;margin:0 auto;padding:24px 24px 80px; }
        .df-card { background:rgba(16,185,129,0.05);border:1px solid rgba(16,185,129,0.15);border-radius:var(--radius-lg);padding:36px; }
        .df-section { margin-bottom:28px; }
        .df-section-label { font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#10b981;margin-bottom:10px; }
        .df-synthesis { font-family:var(--font-serif);font-size:clamp(18px,3vw,24px);line-height:1.45;color:var(--bone);font-weight:400; }
        .df-pattern { padding:12px 16px;background:rgba(16,185,129,0.06);border-radius:var(--radius-sm);font-size:15px;color:var(--chrome);line-height:1.5;margin-bottom:8px; }
        .df-practice { font-size:16px;color:var(--bone);line-height:1.6;font-style:italic; }
        .df-actions { display:flex;gap:12px;margin-top:28px;flex-wrap:wrap; }
        .df-queued { text-align:center;padding:60px 24px;color:var(--chrome-2); }
      `}</style>

      <div className="df-root">
        <nav className="nav"><div className="nav-inner">
          <Link href="/launcher" className="nav-back">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            All spaces
          </Link>
          <span className="nav-wordmark" style={{color:"#10b981"}}>Defrag</span>
        </div></nav>

        {phase === "landing" && (
          <section className="df-hero">
            <div className="orb orb-center" style={{background:"radial-gradient(circle,rgba(16,185,129,0.12),transparent 70%)",opacity:.8}}/>
            <div className="df-badge">◈ Defrag</div>
            <h1 className="df-h1">See the patterns before they become arguments.</h1>
            <p className="df-sub">Every family and partnership has a rhythm. Defrag helps you understand how the people you love process the world, so you can communicate without the guesswork.</p>
            <button className="btn btn-lg fade-up-3" style={{background:"#10b981",color:"#080808",fontWeight:700}} onClick={() => session ? setPhase("ask") : signIn()}>
              Begin →
            </button>
            {!session && <p className="t-tiny t-muted" style={{marginTop:16}}>Free — no card required</p>}
          </section>
        )}

        {phase === "ask" && (
          <section className="df-hero">
            <div className="df-form-wrap fade-up">
              <p className="t-eyebrow" style={{color:"#10b981",marginBottom:24}}>◈ Defrag</p>
              <h2 style={{fontFamily:"var(--font-serif)",fontSize:"clamp(24px,4vw,36px)",color:"var(--bone)",marginBottom:32,lineHeight:1.2}}>Who are you trying to connect with right now?</h2>
              <form className="df-form" onSubmit={handleSubmit}>
                <div>
                  <label className="df-label">Their name or relationship to you</label>
                  <input className="input" value={who} onChange={e=>setWho(e.target.value)} placeholder="My partner, my mom, my colleague…" autoFocus required />
                </div>
                <div>
                  <label className="df-label">What's happening between you? <span style={{opacity:.5}}>(optional)</span></label>
                  <textarea className="textarea" value={situation} onChange={e=>setSituation(e.target.value)} placeholder="We keep having the same argument. When I try to talk, they shut down…" rows={4}/>
                </div>
                <button type="submit" className="btn btn-primary btn-full btn-lg" style={{background:"#10b981",color:"#080808",marginTop:8}}>Show me the pattern</button>
              </form>
            </div>
          </section>
        )}

        {phase === "thinking" && (
          <div className="df-thinking">
            <div className="df-thinking-ring"/>
            <p style={{color:"var(--chrome-3)",fontSize:15}}>Reading the rhythm between you…</p>
          </div>
        )}

        {phase === "result" && result && (
          <div className="df-result fade-up" style={{paddingTop:100}}>
            <div className="df-card">
              <div className="df-section">
                <div className="df-section-label">What's happening</div>
                <p className="df-synthesis">{result.synthesis}</p>
              </div>
              <div className="df-section">
                <div className="df-section-label">Patterns to notice</div>
                {result.patterns.map((p,i) => <div key={i} className="df-pattern">— {p}</div>)}
              </div>
              <div className="df-section">
                <div className="df-section-label">One thing to try today</div>
                <p className="df-practice">{result.practice}</p>
              </div>
              <div className="df-actions">
                <button className="btn btn-ghost" onClick={() => { setPhase("ask"); setResult(null); }}>Try another</button>
                <Link href="/launcher" className="btn btn-ghost">Back to spaces</Link>
              </div>
            </div>
          </div>
        )}

        {phase === "queued" && (
          <div className="df-queued" style={{paddingTop:120}}>
            <p style={{fontSize:40,marginBottom:16}}>◎</p>
            <h3 style={{fontFamily:"var(--font-serif)",fontSize:24,color:"var(--bone)",marginBottom:12}}>We'll pick this up shortly.</h3>
            <p style={{color:"var(--chrome-3)"}}>The service is resting. Your request is safe and will resume automatically.</p>
            <button className="btn btn-ghost" style={{marginTop:24}} onClick={()=>setPhase("ask")}>Try again</button>
          </div>
        )}

        {phase === "error" && (
          <div className="df-queued" style={{paddingTop:120}}>
            <p style={{color:"var(--chrome-3)",marginBottom:20}}>{error}</p>
            <button className="btn btn-ghost" onClick={()=>setPhase("ask")}>Go back</button>
          </div>
        )}
      </div>
    </>
  );
}
