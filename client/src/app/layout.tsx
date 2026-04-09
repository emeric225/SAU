import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SAU - Système d\'Alerte d\'Urgence | Côte d\'Ivoire',
  description: 'Plateforme universelle d\'alerte d\'urgence. Scanner un QR Code pour localiser les secours instantanément.',
  keywords: ['urgence', 'secours', 'pompier', 'GSPM', 'Abidjan', 'Côte d\'Ivoire', 'alerte', 'sécurité'],
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'SAU Tactique',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <head>
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="theme-color" content="#060c1a" />
      </head>
      <body style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        {children}
      </body>
    </html>
  );
}
