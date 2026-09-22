import type { MetadataRoute } from 'next';

/**
 * Lets the office add the CRM to a phone's home screen as a real app.
 *
 * This is the only way they reach it from a phone at all: GoHighLevel's mobile
 * app does not render custom menu links, so the sidebar entry that works on a
 * desktop simply is not there. `standalone` drops the browser chrome, which
 * buys back about 100px on a screen that has none to spare.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Cory Home Team — Truck Operations',
    short_name: 'CHT Trucks',
    description: 'Truck rental board, calendar and paperwork.',
    start_url: '/app',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f4f5f7',
    theme_color: '#16181c',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
