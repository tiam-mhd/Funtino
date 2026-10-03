'use client';

import type { ReactNode } from 'react';

import { CustomerAuthGate } from './customer-auth-gate';

export function CustomerShell({ children, locale }: { children: ReactNode; locale: string }) {
  return <CustomerAuthGate locale={locale}>{children}</CustomerAuthGate>;
}
