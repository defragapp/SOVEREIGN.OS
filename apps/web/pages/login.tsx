import React from "react";
export default function Login() {
  return (
    <main style={{padding:24,fontFamily:"system-ui,Arial"}}>
      <h2>Sign in to Sovereign.OS</h2>
      <p>
        <a href="https://auth.defrag.app/auth/oauth/start?provider=github&returnTo=https://sovereign.defrag.app">Sign in with GitHub</a>
      </p>
    </main>
  );
}
