import React, { useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useSession, signIn } from "next-auth/react";
import { dispatch, WorkerUnavailableError } from "../../lib/worker-client";

type Phase = "landing"|"ask"|"thinking"|"result"|"queued"|"error";
interface Result { shift: string; step: string; reflection: string; }

export default function Alignment() {
  const { data: session } = useSession();
  const [phase, setPhase] = useState<Phase>("landing");
  const [mind, setMind] = useState("");
  const [result, setResult] = useState<Result|null>(null);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!session) { signIn(); return; }
    if (!mind.trim()) return;
    setPhase("thinking");
    try {
      const data = await dispatch<{ reasoning: string; recommendations: string[] }>({
        operation: "alignment",
        payload: {
          session_id: crypto.randomUUID(),
          agent_id: "alignment-agent",
          prompt: `You are SOVEREIGN ALIGNMENT — a gentle, grounded guide. The user has shared what is on their mind. Respond with deep empathy, no clinical language.\n\nWhat is on their mind: "${mind}"\n\nProvide three things:\n1. ONE INTERNAL SHIFT: A single, immediate reframe or gentle perspective that helps them feel more grounded right now (1-2 sentences, warm, poetic)\n2. ONE PRACTICAL STEP: A concrete, doable outward action they can take today (1 sentence, specific)\n3. A SHORT REFLECTION: One question to sit with that opens possibility (1 sentence)\n\nDo not number these. Use natural, warm language. Never clinical.`,
          temperature: 0.65,
          stream: false,
        },
      });
      const recs = data.recommendations;
      const lines = data.reasoning.split("\n\n").filter(Boolean);
      setResult({
        shift: lines[0] ?? recs[0] ?? data.reasoning.slice(0, 200),
        step: lines[1] ?? recs[1] ?? "Take one small action that feels aligned today.",
        reflection: lines[2] ?? recs[2] ?? "What would feel most true to you right now?",
      });
      setPhase("result");
    } catch (err) {
      if (err instanceof WorkerUnavailableError) { setPhase("queued"); return; }
      setError("Something shifted unexpectedly. Please try again."); setPhase("error");
    }
  }

  const accent = "#818cf8";

  return (
    <>
      <Head>
        <title>Alignment — SOVEREIGN</title>
        <meta name="description" content="Find your center. Know your next right step." />
        <meta name="theme-color" content="#0a0a14" />
      </Head>
      <style>{`
        .al-root{min-height:100dvh;background:radial-gradient(ellipse 80% 60% at 50% 0%,rgba(129,140,248,0.09) 0%,#080808 60%);}
        .al-hero{min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:80px 24px 60px;text-align:center;}
        .al-badge{display:inline-flex;align-items:center;gap:8px;padding:6px 16px;border-radius:100px;background:rgba(129,140,248,0.1);border:1px solid rgba(129,140,248,0.25);font-size:12px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#818cf8;margin-bottom:28px;}
        .al-h1{font-family:var(--font-serif);font-size:clamp(36px,7vw,72px);font-weight:700;line-height:1.05;letter-spacing:-0.03em;color:var(--bone);margin-bottom:20px;max-width:680px;}
        .al-sub{font-size:clamp(16px,2vw,19px);color:var(--chrome-2);line-height:1.65;max-width:480px;margin:0 auto 44px;}
        .al-ask-wrap{width:100%;max-width:600px;margin:0 auto;padding:80px 24px;}
        .al-textarea-big{width:100%;padding:24px;background:rgba(129,140,248,0.04);border:1px solid rgba(129,140,248,0.2);border-radius:var(--radius-lg);font-size:18px;color:var(--bone);line-height:1.7;min-height:180px;resize:none;outline:none;font-family:var(--font-serif);transition:border-color .2s;}
        .al-textarea-big::placeholder{color:rgba(200,200,200,0.25);}
        .al-textarea-big:focus{border-color:rgba(129,140,248,0.5);}
        .al-thinking{display:flex;flex-direction:column;align-items:center;gap:24px;padding:80px 24px;text-align:center;}
        .al-ring{width:56px;height:56px;border-radius:50%;border:2px solid rgba(129,140,248,0.2);border-top-color:#818cf8;animation:spin 1s linear infinite;}
        .al-result{max-width:600px;margin:0 auto;padding:80px 24px;}
        .al-card{background:rgba(129,140,248,0.04);border:1px solid rgba(129,140,248,0.15);border-radius:var(--radius-xl);padding:48px 40px;}
        @media(max-width:640px){.al-card{padding:28px 20px;}}
        .al-section{margin-bottom:36px;}
        .al-section-label{font-size:10px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#818cf8;margin-bottom:14px;}
        .al-shift{font-family:var(--font-serif);font-size:clamp(20px,3vw,28px);line-height:1.4;color:var(--bone);font-weight:400;}
        .al-step{font-size:17px;color:var(--chrome);line-height:1.6;padding:16px 20px;background:rgba(129,140,248,0.06);border-radius:var(--radius-sm);border-left:3px solid #818cf8;}
        .al-reflection{font-size:16px;color:var(--chrome-2);line-height:1.6;font-style:italic;}
      `}</style>
      <div className="al-root">
        <nav className="nav"><div className="nav-inner">
          <Link href="/launcher" className="nav-back">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            All spaces
          </Link>
          <span className="nav-wordmark" style={{color:accent}}>Alignment</span>
        </div></nav>

        {phase === "landing" && (
          <section className="al-hero">
            <div className="orb orb-center" style={{background:"radial-gradient(circle,rgba(129,140,248,0.12),transparent 70%)"}}/>
            <div className="al-badge">◎ Alignment</div>
            <h1 className="al-h1">Find your center.<br/>Know your next right step.</h1>
            <p className="al-sub">Life moves fast, and it is easy to lose your footing. Alignment helps you step back, breathe, and move forward in a way that feels true to you.</p>
            <button className="btn btn-lg fade-up-3" style={{background:accent,color:"#080808",fontWeight:700}} onClick={()=>session?setPhase("ask"):signIn()}>
              Begin →
            </button>
            {!session && <p className="t-tiny t-muted" style={{marginTop:16}}>Free — no card required</p>}
          </section>
        )}

        {phase === "ask" && (
          <div className="al-ask-wrap fade-up">
            <p className="t-eyebrow" style={{color:accent,marginBottom:20}}>◎ Alignment</p>
            <h2 style={{fontFamily:"var(--font-serif)",fontSize:"clamp(22px,4vw,34px)",color:"var(--bone)",marginBottom:28,lineHeight:1.2}}>What is on your mind today?</h2>
            <form onSubmit={handleSubmit} style={{display:"flex",flexDirection:"column",gap:16}}>
              <textarea className="al-textarea-big" value={mind} onChange={e=>setMind(e.target.value)} placeholder="Pour it out here. This is a private space." autoFocus required rows={6}/>
              <button type="submit" className="btn btn-primary btn-full btn-lg" style={{background:accent,color:"#080808",fontWeight:700}}>
                Find my footing
              </button>
            </form>
          </div>
        )}

        {phase === "thinking" && (
          <div className="al-thinking">
            <div className="al-ring"/>
            <p style={{color:"var(--chrome-3)",fontSize:15}}>Sitting with what you shared…</p>
          </div>
        )}

        {phase === "result" && result && (
          <div className="al-result fade-up">
            <div className="al-card">
              <div className="al-section">
                <div className="al-section-label">One internal shift</div>
                <p className="al-shift">{result.shift}</p>
              </div>
              <div className="al-section">
                <div className="al-section-label">One practical step</div>
                <p className="al-step">{result.step}</p>
              </div>
              <div className="al-section">
                <div className="al-section-label">A question to sit with</div>
                <p className="al-reflection">{result.reflection}</p>
              </div>
              <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
                <button className="btn btn-ghost" onClick={()=>{setPhase("ask");setResult(null);}}>Something else</button>
                <Link href="/launcher" className="btn btn-ghost">Back to spaces</Link>
              </div>
            </div>
          </div>
        )}

        {phase === "queued" && (
          <div style={{textAlign:"center",padding:"120px 24px"}}>
            <p style={{fontSize:36,marginBottom:16}}>◎</p>
            <h3 style={{fontFamily:"var(--font-serif)",fontSize:22,color:"var(--bone)",marginBottom:12}}>We'll return to this.</h3>
            <p style={{color:"var(--chrome-3)"}}>The space is temporarily resting. Your words are safe.</p>
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
