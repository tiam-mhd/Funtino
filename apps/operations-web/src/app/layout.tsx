import type { Metadata } from 'next';

import '@fontsource/vazirmatn/arabic.css';
import '@fontsource/estedad/arabic.css';
import '@funtino/design-system/styles.css';
import '@funtino/forms-renderer/forms.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'فانتینو | پنل عملیات',
  description: 'ورود امن و انتخاب محدوده‌ی مجاز مجموعه یا شعبه در پنل عملیات فانتینو',
  icons: {
    icon: '/brand/operations-panel-logo.webp',
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fa" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
