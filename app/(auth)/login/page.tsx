'use client';

import Image from 'next/image';
import { useState } from 'react';
import { createClient } from '../../../lib/supabase/browser';
import { rewards } from '../../../lib/rewards';

export default function LoginPage() {
  const supabase = createClient();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);

    rewards.unlockAudioFromGesture();
    rewards.tap();

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);

    if (error) {
      setError(error.message);
      return;
    }

    window.location.href = '/dashboard';
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 16,
        background:
          'radial-gradient(circle at top, #A78BFA 0%, #7C3AED 38%, #2E1065 100%)'
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          borderRadius: 32,
          overflow: 'hidden',
          boxShadow: '0 25px 60px rgba(0,0,0,0.35)',
          background: 'rgba(255,255,255,0.92)',
          backdropFilter: 'blur(14px)'
        }}
      >
        <div
          style={{
            position: 'relative',
            height: 240,
            background: 'linear-gradient(135deg, #5B21B6, #4F46E5, #7C3AED)'
          }}
        >
          <div style={{ position: 'absolute', inset: 0, opacity: 0.35 }}>
            <div
              style={{
                position: 'absolute',
                top: -40,
                left: -40,
                width: 220,
                height: 220,
                borderRadius: 999,
                background: '#F472B6',
                filter: 'blur(40px)'
              }}
            />
            <div
              style={{
                position: 'absolute',
                bottom: -50,
                right: -50,
                width: 240,
                height: 240,
                borderRadius: 999,
                background: '#22D3EE',
                filter: 'blur(45px)'
              }}
            />
          </div>

          <div
            style={{
              position: 'relative',
              height: '100%',
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'center',
              paddingBottom: 6
            }}
          >
            <Image
              src="/art/chorex-login.png"
              alt="Chorex mascot"
              width={360}
              height={260}
              priority
              style={{
                userSelect: 'none',
                filter: 'drop-shadow(0 18px 28px rgba(0,0,0,0.35))'
              }}
            />
          </div>
        </div>

        <form onSubmit={onSubmit} style={{ padding: 22 }}>
          <div style={{ textAlign: 'center', marginBottom: 14 }}>
            <div style={{ fontSize: 34, fontWeight: 900, color: '#5B21B6', lineHeight: 1.05 }}>
              Game of Chores
            </div>
            <div style={{ marginTop: 6, fontSize: 16, color: '#6D28D9', fontWeight: 700 }}>
              Do chores. Earn rewards. Level up!
            </div>
          </div>

          <div style={{ display: 'grid', gap: 12 }}>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              type="email"
              placeholder="Email"
              autoComplete="email"
              style={{
                width: '100%',
                borderRadius: 18,
                border: '1px solid rgba(124,58,237,0.18)',
                padding: '14px 14px',
                fontSize: 16,
                outline: 'none'
              }}
            />

            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              type="password"
              placeholder="Password"
              autoComplete="current-password"
              style={{
                width: '100%',
                borderRadius: 18,
                border: '1px solid rgba(124,58,237,0.18)',
                padding: '14px 14px',
                fontSize: 16,
                outline: 'none'
              }}
            />

            {error ? (
              <div
                style={{
                  borderRadius: 18,
                  padding: '12px 12px',
                  background: 'rgba(239,68,68,0.10)',
                  color: '#B91C1C',
                  fontWeight: 700
                }}
              >
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={busy}
              style={{
                width: '100%',
                borderRadius: 20,
                border: 'none',
                padding: '14px 14px',
                fontSize: 18,
                fontWeight: 900,
                cursor: busy ? 'not-allowed' : 'pointer',
                background: busy ? 'rgba(124,58,237,0.55)' : '#7C3AED',
                color: '#fff',
                boxShadow: '0 14px 28px rgba(124,58,237,0.35)'
              }}
            >
              {busy ? 'Signing in...' : 'PLAY NOW'}
            </button>

            <div style={{ textAlign: 'center', opacity: 0.75, fontSize: 12 }}>
              Earn Rs. by completing daily chores.
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
