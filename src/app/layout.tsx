import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Navbar } from "@/components/layout/Navbar";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { CommandPalette } from "@/components/ui/CommandPalette";
import { FeedbackButton } from "@/components/feedback/FeedbackButton";
import { ServiceWorkerRegistrar } from "@/components/pwa/ServiceWorkerRegistrar";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { NotificationGateProvider } from "@/components/pwa/NotificationGate";
import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const baseUrl = 'https://newgrad-radar.vercel.app';

export const metadata: Metadata = {
  title: "HireRadar - Tech Jobs at Every Level",
  description: "Track software engineering jobs at top tech companies",
  metadataBase: new URL(baseUrl),
  openGraph: {
    title: "HireRadar - Tech Jobs at Every Level",
    description: "Track software engineering jobs at top tech companies",
    type: "website",
    url: baseUrl,
    siteName: "HireRadar",
  },
  twitter: {
    card: "summary_large_image",
    title: "HireRadar - Tech Jobs at Every Level",
    description: "Track software engineering jobs at top tech companies",
  },
  // PWA: installable app metadata.
  applicationName: "HireRadar",
  appleWebApp: {
    capable: true,
    title: "HireRadar",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#2563eb",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased scroll-smooth dark`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-slate-50 dark:bg-slate-950 transition-colors relative">
        {/* Gradient background overlay */}
        <div
          className="fixed inset-0 -z-10 pointer-events-none"
          aria-hidden="true"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-50/50 via-slate-50 to-emerald-50/30 dark:from-indigo-950/30 dark:via-slate-950 dark:to-emerald-950/20" />
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-indigo-200/20 dark:bg-indigo-500/5 rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-emerald-200/20 dark:bg-emerald-500/5 rounded-full blur-3xl" />
        </div>

        <ThemeProvider>
          <NotificationGateProvider>
          {/* Skip to content link for keyboard users */}
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-blue-600 focus:text-white focus:rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Skip to main content
          </a>
          <Navbar />
          <main
            id="main-content"
            className="flex-1 animate-in fade-in duration-300"
            tabIndex={-1}
          >
            <ErrorBoundary>
              {children}
            </ErrorBoundary>
          </main>

          {/* Global Command Palette */}
          <CommandPalette />

          {/* Floating Feedback Button */}
          <FeedbackButton />

          {/* PWA: register the service worker + offer install */}
          <ServiceWorkerRegistrar />
          <InstallPrompt />

          {/* First-run guided onboarding (self-gates to signed-in first-timers) */}
          <OnboardingFlow />
          </NotificationGateProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
