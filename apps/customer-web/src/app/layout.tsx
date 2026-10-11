import type { Metadata } from 'next';
import '@fontsource/estedad/arabic.css';
import '@funtino/design-system/styles.css';
import '@funtino/forms-renderer/forms.css';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'فانتینو | تجربه‌ی بازی و خانواده',
    template: '%s | فانتینو',
  },
  description: 'وب‌اپ مشتری فانتینو برای کشف شعبه، کارت، خانواده و مأموریت‌ها.',
  applicationName: 'Funtino',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/brand/funtino-logo.png',
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fa" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
