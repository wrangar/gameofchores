'use client';
import { useEffect } from 'react';
import { createClient } from '../../../lib/supabase/browser';

export default function LogoutPage() {
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.signOut().finally(() => {
      window.location.href = '/login';
    });
  }, []);

  return <p>Signing out...</p>;
}
