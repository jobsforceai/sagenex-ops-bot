import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sagenex Ops Bot',
  description: 'Read-only agent for the Sagenex operations team.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en"><body>{children}</body></html>
  );
}
