import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'KI-Rezeption Admin Dashboard',
  description: 'Simple admin interface to manage webhook users',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body className="min-h-screen flex flex-col">
        {children}
      </body>
    </html>
  );
}