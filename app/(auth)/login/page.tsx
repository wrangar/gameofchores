'use client';
import { useState } from 'react';
import { createClient } from '../../../lib/supabase/browser';

export default function LoginPage() {
  const supabase = createClient();
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [msg,setMsg]=useState<string|null>(null);
  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setMsg(error.message);
    else window.location.href = '/dashboard';
  };
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <form onSubmit={onSubmit} style={{ width: '100%', maxWidth: 360, display: 'grid', gap: 12 }}>
        <h1 style={{ margin: 0 }}>Chores to $$</h1>
        <label style={{ display: 'grid', gap: 6 }}>
          <span>Email</span>
          <input value={email} onChange={(e)=>setEmail(e.target.value)} required type="email" />
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span>Password</span>
          <input value={password} onChange={(e)=>setPassword(e.target.value)} required type="password" />
        </label>
        {msg ? <p style={{ color: 'crimson', margin: 0 }}>{msg}</p> : null}
        <button type="submit" style={{ padding: 10 }}>Sign in</button>
        <p style={{ margin: 0, opacity: 0.8, fontSize: 12 }}>
          Parent creates kid accounts in Supabase Auth (for speed).
        </p>
      </form>
    </div>
  );
}
