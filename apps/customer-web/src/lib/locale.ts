import { notFound } from 'next/navigation';

export const supportedLocales = ['fa'] as const;
export type Locale = (typeof supportedLocales)[number];

export function isSupportedLocale(value: string): value is Locale {
  return supportedLocales.includes(value as Locale);
}

export async function readLocale(params: Promise<{ locale: string }>): Promise<Locale> {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  return locale;
}
