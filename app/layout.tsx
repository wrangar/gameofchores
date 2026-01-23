import type { ReactNode } from 'react';

import './globals.css';

export const metadata = {
  title: 'gameofchores.fun',
  description: 'Chores, money, goals, and family finance—gamified.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
