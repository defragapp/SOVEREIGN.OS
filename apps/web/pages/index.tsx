import { useState } from "react";

export default function Home() {
  const [result, setResult] = useState<any>(null);

  async function sendPing() {
    const res = await fetch("/api/proxy-dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "ping" })
    });
    const json = await res.json();
    setResult(json);
  }

  return (
    <div style={{ padding: 40, fontFamily: "sans-serif" }}>
      <h1>Sovereign.OS — Frontend Placeholder</h1>
      <button onClick={sendPing}>Send Dispatch</button>
      <pre>{result ? JSON.stringify(result, null, 2) : "No response yet"}</pre>
    </div>
  );
}