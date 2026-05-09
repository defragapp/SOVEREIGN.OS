import React, { useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useSession, signIn } from "next-auth/react";
import { dispatch, WorkerUnavailableError } from "../../lib/worker-client";

type Phase = "landing"|"ask"|"seeking"|"result"|"queued"|"error";
interface Result { scripture: string; reference: string; parallel: string; step: string; }

export default function Covenant() {
  const { data: session } = useSession();
  const [phase, setPhase] = useState<Phase>("landing");
  const [relationship, setRelationship] = useState("");
  const [situation, setSituation] = useState("");
  const [result, setResult] = useState<Result|null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!session) { signIn(); return; }
    if (!relationship.trim()) return;
    setPhase("seeking");
    try {
      const data = await dispatch<{ reasoning: string; recommendations: string[] }>({
        operation: "alignment",
        payload: {
          session_id: crypto.randomUUID(),
          agent_id: "covenant-agent",
          prompt: `You are SOVEREIGN COVENANT — a wise, Christ-centered guide who speaks with grace, warmth, and practical wisdom from Scripture. You do not preach. You illuminate.\n\nRelationship needing guidance: "${relationship}"\nSituation: "${situation || "seeking wisdom for this relationship"}"\n\nProvide:\n1. SCRIPTURE: A specific, relevant verse or short passage (quote it exactly, beautifully)\n2. REFERENCE: The book, chapter, and verse (e.g., "Ruth 1:16")\n3. PARALLEL: A warm 2-sentence reflection connecting this scripture to their specific situation — natural and empathetic, not preachy\n4. STEP: One faithful, practical step they can take today — grounded and actionable\n\nSpeak as a trusted, wise friend who knows Scripture deeply but wears it lightly.`,
          temperature: 0.6,
          stream: false,
        },
      });
      const recs = data.recommendations;
      const lines = data.reasoning.split("\n\n").filter(l => l.trim());
      setResult({
        scripture: lines[0] ?? recs[0] ?? '"Love is patient, love is kind."',
        reference: lines[1]?.match(/\w+ \d+:\d+/)?.[0] ?? "1 Corinthians 13:4",
        parallel: lines[2] ?? recs[1] ?? "This passage speaks directly to the patience this relationship is calling you toward.",
        step: lines[3] ?? recs[2] ?? "Write a short, honest note of appreciation to the person you are thinking of.",
      });
      setPhase("result");
    } catch (err) {
      if (err instanceof WorkerUnavailableError) { setPhase("queued"); return; }
      setPhase("error");
    }
  }

  const accent = "#d97706";
  const accentLight = "#fbbf24";

  return (
    <>
      <Head>
        <title>Covenant — SOVEREIGN</title>
        <meta name="description" content="Timeless wisdom for today's relationships." />
        <meta name="theme-color" content="#0f0a00" />
      </Head>
      <style>{`
        .cv-root{min-height:100dvh;background:radial-gradient(ellipse 80% 60% at 50% 0%,rgba(217,119,6,0.08) 0%,#080808 60%);}
        .cv-hero{min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:80px 24px 60px;text-align:center;}
        .cv-badge{display:inline-flex;align-items:center;gap:8px;padding:6px 16px;border-radius:100px;background:rgba(217,119,6,0.1);border:1px solid rgba(217,119,6,0.3);font-size:12px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#d97706;margin-bottom:28px;}
        .cv-h1{font-family:var(--font-serif);font-size:clamp(36px,7vw,72px);font-weight:700;line-height:1.05;letter-spacing:-0.03em;color:var(--bone);margin-bottom:20px;max-width:720px;}
        .cv-sub{font-size:clamp(16px,2vw,19px);color:var(--chrome-2);line-height:1.65;max-width:500px;margin:0 auto 44px;}
        .cv-form-wrap{width:100%;max-width:580px;margin:0 auto;padding:80px 24px;}
        .cv-label{font-size:13px;font-weight:600;color:var(--chrome-3);letter-spacing:.04em;margin-bottom:6px;display:block;}
        .cv-seeking{display:flex;flex-direction:column;align-items:center;gap:24px;padding:80px 24px;text-align:center;}
        .cv-ring{width:56px;height:56px;border-radius:50%;border:2px solid rgba(217,119,6,0.2);border-top-color:#d97706;animation:spin 1s linear infinite;}
        .cv-result{max-width:620px;margin:0 auto;padding:80px 24px;}
        .cv-card{background:rgba(217,119,6,0.04);border:1px solid rgba(217,119,6,0.18);border-radius:var(--radius-xl);padding:48px 40px;}
        @media(max-width:640px){.cv-card{padding:28px 20px;}}
        .cv-label-sm{font-size:10px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#d97706;margin-bottom:12px;}
        .cv-scripture{font-family:var(--font-serif);font-size:clamp(19px,3vw,26px);line-height:1.5;color:var(--bone);font-style:italic;margin-bottom:8px;}
        .cv-ref{font-size:13px;color:#d97706;font-weight:600;letter-spacing:.06em;margin-bottom:32px;}
        .cv-parallel{font-size:16px;color:var(--chrome);line-height:1.7;margin-bottom:32px;padding:20px 24px;background:rgba(217,119,6,0.06);border-radius:var(--radius);}
        .cv-step{font-size:16px;color:var(--bone);line-height:1.6;padding-left:16px;border-left:3px solid #d97706;}
      `}</style>

      <div className="cv-root">
        <nav className="nav"><div className="nav-inner">
          <Link href="/launcher" className="nav-back">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            All spaces
          </Link>
          <span className="nav-wordmark" style={{color:accent}}>Covenant</span>
        </div></nav>

        {phase === "landing" && (
          <section className="cv-hero">
            <div className="orb orb-center" style={{background:`radial-gradient(circle,rgba(217,119,6,0.1),transparent 70%)`}}/>
            <div className="cv-badge">✦ Covenant</div>
            <h1 className="cv-h1">Timeless wisdom for<br/>today's relationships.</h1>
            <p className="cv-sub">Find guidance for your family's story through the lens of Scripture. Covenant maps your current relationship to Biblical wisdom, offering practical, Christ-focused steps for healing and moving forward.</p>
            <button className="btn btn-lg fade-up-3" style={{background:accent,color:"#080808",fontWeight:700}} onClick={()=>session?setPhase("ask"):signIn()}>
              Seek guidance →
            </button>
            {!session && <p className="t-tiny t-muted" style={{marginTop:16}}>Pro feature — free trial included</p>}
          </section>
        )}

        {phase === "ask" && (
          <div className="cv-form-wrap fade-up">
            <p className="t-eyebrow" style={{color:accent,marginBottom:20}}>✦ Covenant</p>
            <h2 style={{fontFamily:"var(--font-serif)",fontSize:"clamp(22px,4vw,34px)",color:"var(--bone)",marginBottom:32,lineHeight:1.2}}>What relationship needs guidance today?</h2>
            <form onSubmit={handleSubmit} style={{display:"flex",flexDirection:"column",gap:16}}>
              <div>
                <label className="cv-label">Who is this relationship with?</label>
                <input className="input" value={relationship} onChange={e=>setRelationship(e.target.value)} placeholder="My spouse, my child, my sibling, my parent…" autoFocus required/>
              </div>
              <div>
                <label className="cv-label">What is happening? <span style={{opacity:.5}}>(optional)</span></label>
                <textarea className="textarea" value={situation} onChange={e=>setSituation(e.target.value)} placeholder="We are struggling to forgive each other. We keep repeating the same pattern. I feel distant and don't know how to reconnect…" rows={4}/>
              </div>
              <button type="submit" className="btn btn-primary btn-full btn-lg" style={{background:accent,color:"#080808",fontWeight:700,marginTop:4}}>
                Open the wisdom
              </button>
            </form>
          </div>
        )}

        {phase === "seeking" && (
          <div className="cv-seeking">
            <div className="cv-ring"/>
            <p style={{color:"var(--chrome-3)",fontSize:15}}>Searching Scripture for your situation…</p>
          </div>
        )}

        {phase === "result" && result && (
          <div className="cv-result fade-up">
            <div className="cv-card">
              <div className="cv-label-sm" style={{marginBottom:16}}>A word for you</div>
              <p className="cv-scripture">{result.scripture}</p>
              <p className="cv-ref">— {result.reference}</p>
              <div className="cv-label-sm">How this speaks to your situation</div>
              <p className="cv-parallel">{result.parallel}</p>
              <div className="cv-label-sm" style={{marginBottom:12}}>One faithful step</div>
              <p className="cv-step">{result.step}</p>
              <div style={{display:"flex",gap:12,marginTop:32,flexWrap:"wrap"}}>
                <button className="btn btn-ghost" onClick={()=>{setPhase("ask");setResult(null);setRelationship("");setSituation("");}}>Another relationship</button>
                <Link href="/launcher" className="btn btn-ghost">Back to spaces</Link>
              </div>
            </div>
          </div>
        )}

        {(phase==="queued"||phase==="error") && (
          <div style={{textAlign:"center",padding:"120px 24px"}}>
            <h3 style={{fontFamily:"var(--font-serif)",fontSize:22,color:"var(--bone)",marginBottom:12}}>
              {phase==="queued"?"Resting briefly.":"Something shifted."}
            </h3>
            <p style={{color:"var(--chrome-3)"}}>Please try again in a moment.</p>
            <button className="btn btn-ghost" style={{marginTop:24}} onClick={()=>setPhase("ask")}>Try again</button>
          </div>
        )}
      </div>
    </>
  );
}
