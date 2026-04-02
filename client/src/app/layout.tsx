import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'SAU - Système d\'Alerte d\'Urgence | Côte d\'Ivoire',
  description: 'Plateforme universelle d\'alerte d\'urgence. Scanner un QR Code pour localiser les secours instantanément.',
  keywords: ['urgence', 'secours', 'pompier', 'GSPM', 'Abidjan', 'Côte d\'Ivoire', 'alerte', 'sécurité'],
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <head>
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossOrigin="" />
      </head>
      <body className={inter.className}>
        {children}
      </body>
    </html>
  );
}
