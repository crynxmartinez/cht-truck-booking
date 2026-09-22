import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cory Home Team — Truck Rental',
  description: 'Truck rental agreements and checklists for Cory Home Team.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Without cover, env(safe-area-inset-*) is always 0 and the header sits
  // under the notch once it is launched from the home screen.
  viewportFit: 'cover',
  themeColor: '#16181c',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
