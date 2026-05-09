import React, { useState, useRef } from "react";
import Head from "next/head";
import Link from "next/link";
import { useSession, signIn } from "next-auth/react";
import { dispatch, WorkerUnavailableError } from "../../lib/worker-client";

type Phase = "landing"|"ask"|"dissolving"|"result"|"queued"|"error";

export default function Compression() {
  const { data: session } = useSession();
  const [phase, setPhase] = useState<Phase>("landing");
  const [text, setText] = useState("");
  const [truth, setTruth] = useState("");
  const [charCount, setCharCount] = useState(0);
  const textRef = useRef<HTMLTextAreaElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!session) { signIn(); return; }
    if (!text.trim()) return;
    setCharCount(text.length);
    setPhase("dissolving");
    try {
      const data = await dispatch<{ compressed_content: string }>({
        operation: "compression",
        payload: {
          session_id: crypto.randomUUID(),
          content: `The user is experiencing overwhelm and needs absolute clarity distilled from the following:\n\n${text}\n\nYour task: Find the single most important, actionable truth in all of this. Express it in one powerful, calm sentence. Not a question. Not a list. One sentence of absolute certainty that cuts through everything else. Make it feel like a relief to read.`,
          target_ratio: 0.05,
          format: "summary",
        },
      });
      setTruth(data.compressed_content.replace(/^["']|["']$/g, "").trim());
      setPhase("result");
    } catch (err) {
      if (err instanceof WorkerUnavailableError) { setPhase("queued"); return; }
      setPhase("error");
    }
  }

  const accent = "#f472b6";

  return (
    <>
      <Head>
        <title>Compression — SOVEREIGN</title>
        <meta name="description" content="From overwhelm to absolute clarity in seconds." />
        <meta name="theme-color" content="#0f0008" />
      </Head>
      <style>{`
        .cp-root{min-height:100dvh;background:radial-gradient(ellipse 80% 60% at 50% 0%,rgba(244,114,182,0.08) 0%,#080808 60%);}
        .cp-hero{min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:80px 24px 60px;text-align:center;}
        .cp-badge{display:inline-flex;align-items:center;gap:8px;padding:6px 16px;border-radius:100px;background:rgba(244,114,182,0.1);border:1px solid rgba(244,114,182,0.25);font-size:12px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#f472b6;margin-bottom:28px;}
        .cp-h1{font-family:var(--font-serif);font-size:clamp(36px,7vw,72px);font-weight:700;line-height:1.05;letter-spacing:-0.03em;color:var(--bone);margin-bottom:20px;max-width:760px;}
        .cp-sub{font-size:clamp(16px,2vw,19px);color:var(--chrome-2);line-height:1.65;max-width:480px;margin:0 auto 44px;}
        .cp-canvas-wrap{width:100%;max-width:700px;margin:0 auto;padding:80px 24px;}
        .cp-canvas{width:100%;padding:32px;background:rgba(244,114,182,0.03);border:1px solid rgba(244,114,182,0.15);border-radius:var(--radius-xl);font-size:17px;color:var(--bone);line-height:1.75;min-height:280px;resize:none;outline:none;font-family:var(--font-sans);transition:border-color .2s;caret-color:#f472b6;}
        .cp-canvas::placeholder{color:rgba(200,200,200,0.2);font-style:italic;}
        .cp-canvas:focus{border-color:rgba(244,114,182,0.4);}
        .cp-char{font-size:12px;color:var(--chrome-3);text-align:right;margin-top:8px;}
        .cp-dissolving{min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;overflow:hidden;}
        .cp-dissolve-text{font-size:11px;line-height:1.6;color:rgba(200,200,200,0.15);max-width:500px;text-align:center;word-break:break-word;animation:dissolve 2s ease-in-out forwards;}
        .cp-result{min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:80px 24px;text-align:center;}
        .cp-truth-wrap{max-width:640px;margin:0 auto;}
        .cp-truth{font-family:var(--font-serif);font-size:clamp(22px,4vw,40px);line-height:1.35;color:var(--bone);font-weight:400;letter-spacing:-0.01em;margin-bottom:48px;animation:fadeUp .8s var(--ease-out) .2s both;}
        .cp-line{width:48px;height:2px;background:rgba(244,114,182,0.4);margin:0 auto 48px;animation:fadeIn .8s var(--ease-out) .4s both;}
        @keyframes dissolve{0%{opacity:1;filter:blur(0);}100%{opacity:0;filter:blur(8px);transform:scale(0.95);}}
      `}</style>

      <div className="cp-root">
        <nav className="nav"><div className="nav-inner">
          <Link href="/launcher" className="nav-back">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            All spaces
          </Link>
          <span className="nav-wordmark" style={{color:accent}}>Compression</span>
        </div></nav>

        {phase === "landing" && (
          <section className="cp-hero">
            <div className="orb orb-center" style={{background:"radial-gradient(circle,rgba(244,114,182,0.1),transparent 70%)"}}/>
            <div className="cp-badge">⊞ Compression</div>
            <h1 className="cp-h1">From overwhelm to absolute clarity in seconds.</h1>
            <p className="cp-sub">When there are too many thoughts, decisions, or opinions swirling around, Compression finds the bottom line. Drop in everything you are overthinking.</p>
            <button className="btn btn-lg fade-up-3" style={{background:accent,color:"#080808",fontWeight:700}} onClick={()=>session?setPhase("ask"):signIn()}>
              Pour it out →
            </button>
            {!session && <p className="t-tiny t-muted" style={{marginTop:16}}>Pro feature — free trial included</p>}
          </section>
        )}

        {phase === "ask" && (
          <div className="cp-canvas-wrap fade-up">
            <p className="t-eyebrow" style={{color:accent,marginBottom:16}}>⊞ Compression</p>
            <h2 style={{fontFamily:"var(--font-serif)",fontSize:"clamp(20px,3vw,30px)",color:"var(--bone)",marginBottom:24,lineHeight:1.2}}>Pour it all out here.</h2>
            <form onSubmit={handleSubmit} style={{display:"flex",flexDirection:"column",gap:12}}>
              <textarea ref={textRef} className="cp-canvas" value={text}
                onChange={e=>{setText(e.target.value)}}
                placeholder="Every decision, every worry, every opinion you've heard, every option you are weighing, every thought that won't settle… put it all here." autoFocus required rows={10}/>
              <p className="cp-char">{text.length} characters</p>
              <button type="submit" className="btn btn-primary btn-full btn-lg" style={{background:accent,color:"#080808",fontWeight:700,marginTop:8}}>
                Find the one truth
              </button>
            </form>
          </div>
        )}

        {phase === "dissolving" && (
          <div className="cp-dissolving">
            <p className="cp-dissolve-text">{text.slice(0, 400)}{text.length > 400 ? "…" : ""}</p>
            <p style={{color:"var(--chrome-3)",fontSize:14,marginTop:40,animation:"fadeIn 1s ease .8s both"}}>Dissolving the noise…</p>
          </div>
        )}

        {phase === "result" && (
          <div className="cp-result">
            <div className="cp-truth-wrap">
              <p className="t-eyebrow" style={{color:accent,marginBottom:32,animation:"fadeIn .6s ease both"}}>The one truth</p>
              <p className="cp-truth">"{truth}"</p>
              <div className="cp-line"/>
              <p style={{color:"var(--chrome-3)",fontSize:14,marginBottom:32,animation:"fadeIn .6s ease .6s both"}}>
                Distilled from {charCount.toLocaleString()} characters
              </p>
              <div style={{display:"flex",gap:12,justifyContent:"center",flexWrap:"wrap",animation:"fadeIn .6s ease .8s both"}}>
                <button className="btn btn-ghost" onClick={()=>{setPhase("ask");setTruth("");setText("");}}>Start again</button>
                <Link href="/launcher" className="btn btn-ghost">Back to spaces</Link>
              </div>
            </div>
          </div>
        )}

        {phase === "queued" && (
          <div style={{textAlign:"center",padding:"120px 24px"}}>
            <h3 style={{fontFamily:"var(--font-serif)",fontSize:22,color:"var(--bone)",marginBottom:12}}>Resting briefly.</h3>
            <p style={{color:"var(--chrome-3)"}}>Your words are safe. Try again in a moment.</p>
            <button className="btn btn-ghost" style={{marginTop:24}} onClick={()=>setPhase("ask")}>Try again</button>
          </div>
        )}
        {phase === "error" && (
          <div style={{textAlign:"center",padding:"120px 24px"}}>
            <p style={{color:"var(--chrome-3)",marginBottom:20}}>Something shifted. Please try again.</p>
            <button className="btn btn-ghost" onClick={()=>setPhase("ask")}>Go back</button>
          </div>
        )}
      </div>
    </>
  );
}
