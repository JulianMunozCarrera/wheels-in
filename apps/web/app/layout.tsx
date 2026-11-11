import type { Metadata, Viewport } from 'next';
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Wheels In: a live operating room board',
  description: 'Real time surgical scheduling with emergency bumps and time travel. Built by Julian Munoz.',
};

export const viewport: Viewport = { themeColor: '#0F2A2E' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
