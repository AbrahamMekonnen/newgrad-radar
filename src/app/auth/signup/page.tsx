import { Suspense } from 'react';
import { Metadata } from 'next';
import { AuthForm } from '@/components/auth/AuthForm';

export const metadata: Metadata = {
  title: "Sign Up - NewGrad Radar",
  description: "Create a free NewGrad Radar account to track new grad software engineering jobs at top tech companies",
  openGraph: {
    title: "Sign Up - NewGrad Radar",
    description: "Create a free NewGrad Radar account to track new grad software engineering jobs at top tech companies",
  },
  twitter: {
    title: "Sign Up - NewGrad Radar",
    description: "Create a free NewGrad Radar account to track new grad software engineering jobs at top tech companies",
  },
};

export default function SignUpPage() {
  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12">
      <Suspense fallback={<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />}>
        <AuthForm mode="signup" />
      </Suspense>
    </div>
  );
}
