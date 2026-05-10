import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';

interface Profile {
  display_name: string;
  date_of_birth: string;
}

interface Props {
  children: React.ReactNode;
}

/**
 * ProfileGate â wraps any space page.
 * Checks that the user has completed onboarding (DOB set).
 * Redirects to /onboarding if not, shows a loader while checking.
 */
export default function ProfileGate({ children }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'ok' | 'redirect'>('loading');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/profile')
      .then(r => (r.ok ? r.json() : null))
      .then((profile: Profile | null) => {
        if (cancelled) return;
        if (!profile?.date_of_birth) {
          setStatus('redirect');
          router.replace('/onboarding');
        } else {
          setStatus('ok');
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('ok'); // fail-open so auth handles it
      });
    return () => { cancelled = true; };
  }, [router]);

  if (status === 'loading') {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--color-base)',
      }}>
        <span style={{
          color: 'var(--color-muted)',
          fontSize: '1rem',
          letterSpacing: '0.08em',
          animation: 'pulse 1.6s ease-in-out infinite',
        }}>
          â¦
        </span>
      </div>
    );
  }

  if (status === 'redirect') return null;

  return <>{children}</>;
}
