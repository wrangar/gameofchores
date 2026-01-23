import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Added for Vercel build typing
type CookieToSet = { name: string; value: string; options?: any; };

// Next.js (15+) cookies() is async. Align with Supabase SSR guidance.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // setAll can be called from a Server Component where cookies are read-only.
            // This is safe to ignore if you are not relying on server-side token refresh.
          }
        },
      },
    }
  );
}
