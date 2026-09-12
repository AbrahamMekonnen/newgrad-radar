import { Suspense } from 'react';
import { Metadata } from 'next';
import { AuthForm } from '@/components/auth/AuthForm';

export const metadata: Metadata = {
  title: "Login - NewGrad Radar",
  description: "Sign in to NewGrad Radar to track new grad tech jobs and manage your applications",
  openGraph: {
    title: "Login - NewGrad Radar",
    description: "Sign in to NewGrad Radar to track new grad tech jobs and manage your applications",
  },
  twitter: {
    title: "Login - NewGrad Radar",
    description: "Sign in to NewGrad Radar to track new grad tech jobs and manage your applications",
  },
};

export default function LoginPage() {
  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12">
      <Suspense fallback={<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />}>
        <AuthForm mode="login" />
      </Suspense>
    </div>
  );
}
