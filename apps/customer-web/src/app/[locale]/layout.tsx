import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { isSupportedLocale, supportedLocales } from '../../lib/locale';

export function generateStaticParams() {
  return supportedLocales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{
  children: ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  return <div data-locale={locale}>{children}</div>;
}
