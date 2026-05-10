import React from "react";
import { Button } from "./Button";
export const Header: React.FC = () => (
  <header className="p-4 border-b" role="banner">
    <div className="container" style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
      <div className="logo" style={{fontWeight: 700}}>Sovereign.OS</div>
      <nav style={{display: 'flex', gap: 12, alignItems: 'center'}}>
        <a href="/dashboard">Dashboard</a>
        <a href="/docs">Docs</a>
        <Button variant="ghost">Sign in</Button>
      </nav>
    </div>
  </header>
);