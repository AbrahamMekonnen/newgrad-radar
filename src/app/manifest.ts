import type { MetadataRoute } from 'next';

// Web App Manifest — makes HireRadar installable ("Add to Home Screen") and is
// the foundation for Web Push. Served at /manifest.webmanifest by Next.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'HireRadar',
    short_name: 'HireRadar',
    description: 'Track new-grad tech jobs and get notified the moment a match is posted.',
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0f172a',
    theme_color: '#2563eb',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
