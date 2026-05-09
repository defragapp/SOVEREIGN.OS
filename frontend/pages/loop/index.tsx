import React, { useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useSession, signIn } from "next-auth/react";
import { dispatch, WorkerUnavailableError } from "../../lib/worker-client";

type Phase = "landing"|"ask"|"thinking"|"result"|"queued"|"error";
interface Result { mirror: string; reset: string; affirmation: string; }

export default function Loop() {
  const { data: session } = useSession();
  const [phase, setPhase] = useState<Phase>("landing");
  const [stuck, setStuck] = useState("");
  const [result, setResult] = useState<Result|null>(null);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!session) { signIn(); return; }
    if (!stuck.trim()) return;
    setPhase("thinking");
    try {
      const data = await dispatch<{ reasoning: string; recommendations: string[] }>({
        operation: "alignment",
        payload: {
          session_id: crypto.randomUUID(),
          agent_id: "loop-agent",
          prompt: `You are SOVEREIGN LOOP — a compassionate mirror. Help the user see the thought pattern they are carrying, without judgment. Do not use clinical language.\n\nWhat they are stuck on: "${stuck}"\n\nProvide three things:\n1. THE MIRROR: Gently reflect back the core worry or thought loop they are carrying (1-2 sentences, empathetic, naming it without judgment)\n2. THE RESET: A simple physical or grounded practice to interrupt the loop (specific, doable in 2 minutes)\n3. A GENTLE TRUTH: One warm, honest sentence that helps them release the loop\n\nSpeak like a wise, caring friend. No bullet points. Natural language.`,
          temperature: 0.72,
          stream: false,
        },
      });
      const lines = data.reasoning.split("\n\n").filter(Boolean);
      setResult({
        mirror: lines[0] ?? "You are carrying something heavy, and it keeps circling back.",
        reset: lines[1] ?? data.recommendations[0] ?? "Place both hands on your chest, take three slow breaths, and feel your feet on the floor.",
        affirmation: lines[2] ?? data.recommendations[1] ?? "The thought that keeps returning is asking for your attention, not your agreement.",
      });
      setPhase("result");
    } catch (err) {
      if (err instanceof WorkerUnavailableError) { setPhase("queued"); return; }
      setError("Something shifted. Try again in a moment."); setPhase("error");
    }
  }

  const accent = "#f59e0b";

  return (
    <>
      <Head>
        <title>The Loop — SOVEREIGN</title>
        <meta name="description" content="Stuck in a loop? Let us show you the way out." />
        <meta name="theme-color" content="#0f0c00" />
      </Head>
      <style>{`
        .lp-root{min-height:100dvh;background:radial-gradient(ellipse 80% 60% at 50% 0%,rgba(245,158,11,0.08) 0%,#080808 60%);}
        .lp-hero{min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:80px 24px 60px;text-align:center;}
        .lp-badge{display:inline-flex;align-items:center;gap:8px;padding:6px 16px;border-radius:100px;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.25);font-size:12px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#f59e0b;margin-bottom:28px;}
        .lp-h1{font-family:var(--font-serif);font-size:clamp(36px,7vw,72px);font-weight:700;line-height:1.05;letter-spacing:-0.03em;color:var(--bone);margin-bottom:20px;max-width:720px;}
        .lp-sub{font-size:clamp(16px,2vw,19px);color:var(--chrome-2);line-height:1.65;max-width:480px;margin:0 auto 44px;}
        .lp-ask{width:100%;max-width:600px;margin:0 auto;padding:80px 24px;}
        .lp-ta{width:100%;padding:24px;background:rgba(245,158,11,0.04);border:1px solid rgba(245,158,11,0.2);border-radius:var(--radius-lg);font-size:17px;color:var(--bone);line-height:1.7;min-height:200px;resize:none;outline:none;font-family:var(--font-sans);transition:border-color .2s;}
        .lp-ta::placeholder{color:rgba(200,200,200,0.22);}
        .lp-ta:focus{border-color:rgba(245,158,11,0.45);}
        .lp-thinking{display:flex;flex-direction:column;align-items:center;gap:24px;padding:80px 24px;text-align:center;}
        .lp-ring{width:56px;height:56px;border-radius:50%;border:2px solid rgba(245,158,11,0.2);border-top-color:#f59e0b;animation:spin 1s linear infinite;}
        .lp-result{max-width:600px;margin:0 auto;padding:80px 24px;}
        .lp-card{background:rgba(245,158,11,0.04);border:1px solid rgba(245,158,11,0.15);border-radius:var(--radius-xl);padding:48px 40px;}
        @media(max-width:640px){.lp-card{padding:28px 20px;}}
        .lp-label{font-size:10px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#f59e0b;margin-bottom:14px;}
        .lp-mirror{font-family:var(--font-serif);font-size:clamp(19px,3vw,26px);line-height:1.45;color:var(--bone);margin-bottom:36px;}
        .lp-reset{padding:20px 24px;background:rgba(245,158,11,0.07);border:1px solid rgba(245,158,11,0.15);border-radius:var(--radius);font-size:16px;color:var(--chrome);line-height:1.6;margin-bottom:36px;}
        .lp-truth{font-size:17px;color:var(--chrome-2);line-height:1.65;font-style:italic;}
      `}</style>

      <div className="lp-root">
        <nav className="nav"><div className="nav-inner">
          <Link href="/launcher" className="nav-back">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            All spaces
          </Link>
          <span className="nav-wordmark" style={{color:accent}}>The Loop</span>
        </div></nav>

        {phase === "landing" && (
          <section className="lp-hero">
            <div className="orb orb-center" style={{background:"radial-gradient(circle,rgba(245,158,11,0.1),transparent 70%)"}}/>
            <div className="lp-badge">⟳ The Loop</div>
            <h1 className="lp-h1">Stuck in a loop?<br/>Let us show you the way out.</h1>
            <p className="lp-sub">Sometimes the hardest thing to hear is our own internal dialogue. The Loop acts as a gentle mirror, helping you spot the thoughts holding you back and giving you simple tools to reset.</p>
            <button className="btn btn-lg fade-up-3" style={{background:accent,color:"#080808",fontWeight:700}} onClick={()=>session?setPhase("ask"):signIn()}>Find my way out →</button>
            {!session && <p className="t-tiny t-muted" style={{marginTop:16}}>Free — no card required</p>}
          </section>
        )}

        {phase === "ask" && (
          <div className="lp-ask fade-up">
            <p className="t-eyebrow" style={{color:accent,marginBottom:20}}>⟳ The Loop</p>
            <h2 style={{fontFamily:"var(--font-serif)",fontSize:"clamp(22px,4vw,34px)",color:"var(--bone)",marginBottom:10,lineHeight:1.2}}>What are you stuck on?</h2>
            <p style={{color:"var(--chrome-3)",fontSize:15,marginBottom:28,lineHeight:1.6}}>Write it out. Even the parts you keep circling back to. This is completely private.</p>
            <form onSubmit={handleSubmit} style={{display:"flex",flexDirection:"column",gap:16}}>
              <textarea className="lp-ta" value={stuck} onChange={e=>setStuck(e.target.value)} placeholder="It keeps coming back to… I can't stop thinking about… Every time I try to move on…" autoFocus required rows={7}/>
              <button type="submit" className="btn btn-primary btn-full btn-lg" style={{background:accent,color:"#080808",fontWeight:700}}>Show me the way out</button>
            </form>
          </div>
        )}

        {phase === "thinking" && (
          <div className="lp-thinking">
            <div className="lp-ring"/>
            <p style={{color:"var(--chrome-3)",fontSize:15}}>Looking into the loop with you…</p>
          </div>
        )}

        {phase === "result" && result && (
          <div className="lp-result fade-up">
            <div className="lp-card">
              <div className="lp-label">What you are carrying</div>
              <p className="lp-mirror">{result.mirror}</p>
              <div className="lp-label">A reset practice</div>
              <div className="lp-reset">{result.reset}</div>
              <div className="lp-label">A gentle truth</div>
              <p className="lp-truth">{result.affirmation}</p>
              <div style={{display:"flex",gap:12,marginTop:32,flexWrap:"wrap"}}>
                <button className="btn btn-ghost" onClick={()=>{setPhase("ask");setResult(null);setStuck("");}}>Try another</button>
                <Link href="/launcher" className="btn btn-ghost">Back to spaces</Link>
              </div>
            </div>
          </div>
        )}

        {phase === "queued" && (
          <div style={{textAlign:"center",padding:"120px 24px"}}>
            <h3 style={{fontFamily:"var(--font-serif)",fontSize:22,color:"var(--bone)",marginBottom:12}}>We will return to this.</h3>
            <p style={{color:"var(--chrome-3)"}}>The space is resting. Your words are safe.</p>
            <button className="btn btn-ghost" style={{marginTop:24}} onClick={()=>setPhase("ask")}>Try again</button>
          </div>
        )}
        {phase === "error" && (
          <div style={{textAlign:"center",padding:"120px 24px"}}>
            <p style={{color:"var(--chrome-3)",marginBottom:20}}>{error}</p>
            <button className="btn btn-ghost" onClick={()=>setPhase("ask")}>Go back</button>
          </div>
        )}
      </div>
    </>
  );
}
