import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import './globals.css';
import { SessionProvider } from '@/lib/session/session-provider';

export const metadata: Metadata = {
  title: 'Puntored MVP',
  description: 'Frontend MVP scaffold for Puntored',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="es">
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
