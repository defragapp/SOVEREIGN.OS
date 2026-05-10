import React from "react";
import { Header } from "../ui/components/Header";
import { Card } from "../ui/components/Card";
export default function Dashboard() {
  return (
    <>
      <Header />
      <main className="container" style={{padding: '16px'}}>
        <h1 style={{fontSize: '24px', fontWeight: 700, marginBottom: 16}}>Dashboard</h1>
        <div style={{display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))'}}>
          <Card><h2 style={{margin: 0, fontWeight: 600}}>Traffic</h2><p style={{marginTop: 8}}>Requests: 2</p></Card>
          <Card><h2 style={{margin: 0, fontWeight: 600}}>Alerts</h2><p style={{marginTop: 8}}>No alerts fired</p></Card>
        </div>
      </main>
    </>
  );
}