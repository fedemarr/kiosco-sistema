import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Kiosco · Punto de venta',
  description: 'Caja, stock y turnos de tu kiosco',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Kiosco', statusBarStyle: 'black-translucent' },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-AR">
      <body>{children}</body>
    </html>
  );
}
