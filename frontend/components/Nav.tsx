import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState } from 'react';

const spaces = [
  { href: '/launcher',    label: 'Home',        icon: 'â' },
  { href: '/defrag',      label: 'Defrag',       icon: 'â' },
  { href: '/alignment',   label: 'Alignment',    icon: 'â' },
  { href: '/loop',        label: 'The Loop',     icon: 'â»' },
  { href: '/compression', label: 'Compression',  icon: 'â£' },
  { href: '/covenant',    label: 'Covenant',     icon: 'â¦' },
];

export default function Nav() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Desktop sidebar */}
      <nav className="nav-sidebar" aria-label="Sovereign navigation">
        <Link href="/launcher" className="nav-logo" aria-label="Sovereign home">
          <span className="nav-logo-mark">â¦</span>
          <span className="nav-logo-text">Sovereign</span>
        </Link>
        <ul className="nav-list">
          {spaces.map(s => (
            <li key={s.href}>
              <Link
                href={s.href}
                className={`nav-item ${router.pathname.startsWith(s.href) ? 'active' : ''}`}
              >
                <span className="nav-icon">{s.icon}</span>
                <span className="nav-label">{s.label}</span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="nav-footer">
          <Link href="/settings" className="nav-item nav-settings">
            <span className="nav-icon">â</span>
            <span className="nav-label">Settings</span>
          </Link>
        </div>
      </nav>

      {/* Mobile bottom bar */}
      <nav className="nav-mobile" aria-label="Sovereign mobile navigation">
        {spaces.map(s => (
          <Link
            key={s.href}
            href={s.href}
            className={`nav-mobile-item ${router.pathname.startsWith(s.href) ? 'active' : ''}`}
          >
            <span className="nav-mobile-icon">{s.icon}</span>
            <span className="nav-mobile-label">{s.label}</span>
          </Link>
        ))}
      </nav>

      <style jsx>{`
        /* ââ Desktop sidebar ââ */
        .nav-sidebar {
          position: fixed;
          top: 0; left: 0;
          height: 100vh;
          width: 220px;
          background: rgba(8,8,8,0.85);
          backdrop-filter: blur(20px);
          border-right: 1px solid rgba(255,255,255,0.06);
          display: flex;
          flex-direction: column;
          padding: 28px 16px;
          z-index: 100;
        }
        .nav-logo {
          display: flex;
          align-items: center;
          gap: 10px;
          text-decoration: none;
          margin-bottom: 40px;
          padding: 0 8px;
        }
        .nav-logo-mark {
          font-size: 1.4rem;
          color: var(--color-accent);
          line-height: 1;
        }
        .nav-logo-text {
          font-family: var(--font-display);
          font-size: 1.15rem;
          font-weight: 600;
          color: var(--color-chrome);
          letter-spacing: 0.03em;
        }
        .nav-list {
          list-style: none;
          padding: 0; margin: 0;
          display: flex;
          flex-direction: column;
          gap: 4px;
          flex: 1;
        }
        .nav-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 12px;
          border-radius: 10px;
          text-decoration: none;
          color: var(--color-muted);
          font-size: 0.9rem;
          transition: background 0.2s, color 0.2s;
        }
        .nav-item:hover { background: rgba(255,255,255,0.05); color: var(--color-chrome); }
        .nav-item.active { background: rgba(255,255,255,0.08); color: var(--color-chrome); }
        .nav-icon { font-size: 1.1rem; width: 20px; text-align: center; }
        .nav-footer { border-top: 1px solid rgba(255,255,255,0.06); padding-top: 16px; }

        /* ââ Mobile bottom bar ââ */
        .nav-mobile {
          display: none;
          position: fixed;
          bottom: 0; left: 0; right: 0;
          background: rgba(8,8,8,0.92);
          backdrop-filter: blur(20px);
          border-top: 1px solid rgba(255,255,255,0.06);
          padding: 8px 0;
          padding-bottom: calc(8px + env(safe-area-inset-bottom));
          z-index: 100;
          justify-content: space-around;
          align-items: center;
        }
        .nav-mobile-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 3px;
          text-decoration: none;
          color: var(--color-muted);
          padding: 6px 10px;
          border-radius: 8px;
          transition: color 0.2s;
          min-width: 44px;
        }
        .nav-mobile-item.active { color: var(--color-chrome); }
        .nav-mobile-icon { font-size: 1.2rem; }
        .nav-mobile-label { font-size: 0.6rem; letter-spacing: 0.06em; text-transform: uppercase; }

        @media (max-width: 768px) {
          .nav-sidebar { display: none; }
          .nav-mobile { display: flex; }
        }
      `}</style>
    </>
  );
}
