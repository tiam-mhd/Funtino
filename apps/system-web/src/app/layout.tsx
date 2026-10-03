import type { Metadata } from 'next';

import '@fontsource/vazirmatn/arabic.css';
import '@funtino/design-system/styles.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'فانتینو | پنل سیستم',
  description: 'پنل مدیریت و پشتیبانی سامانه‌ی فانتینو',
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
