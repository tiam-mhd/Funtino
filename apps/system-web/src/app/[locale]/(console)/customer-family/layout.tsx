'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import {
  SystemCustomerFamilySupport,
  type SystemCustomerFamilyView,
} from '../../../../features/customer-family/SystemCustomerFamilySupport';

export default function CustomerFamilyLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const path = pathname.replace(/\/$/, '');
  const view: SystemCustomerFamilyView = path.endsWith('/members')
    ? 'members'
    : path.endsWith('/invitations')
      ? 'invitations'
      : path.endsWith('/history')
        ? 'history'
        : 'lookup';

  return (
    <>
      <SystemCustomerFamilySupport view={view} />
      {children}
    </>
  );
}
