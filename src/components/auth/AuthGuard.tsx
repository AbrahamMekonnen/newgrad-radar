'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { User } from '@supabase/supabase-js';

interface AuthGuardProps {
  children: (user: User) => React.ReactNode;
  fallback?: React.ReactNode;
}

export function AuthGuard({ children, fallback }: AuthGuardProps) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    // Send the user to login but remember where they were headed (e.g. a
    // notification deep-link like /applications?section=alerts), so we can
    // return them there after sign-in instead of dumping them on the board.
    const loginUrl = () => {
      if (typeof window === 'undefined') return '/auth/login';
      const dest = window.location.pathname + window.location.search;
      if (!dest || dest === '/' || dest.startsWith('/auth')) return '/auth/login';
      // AuthForm reads the `redirect` param and returns the user there.
      return `/auth/login?redirect=${encodeURIComponent(dest)}`;
    };

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        router.push(loginUrl());
      } else {
        setUser(user);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (!session?.user) {
        router.push(loginUrl());
      }
    });

    return () => subscription.unsubscribe();
  }, [router, supabase.auth]);

  if (loading) {
    return fallback || (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return <>{children(user)}</>;
}
