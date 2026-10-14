'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { SystemHealth } from '../../../../features/health/SystemHealth';

export default function SystemHealthLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const view = pathname.endsWith('/alerts') ? 'alerts' : 'services';
  return (
    <>
      <SystemHealth view={view} />
      {children}
    </>
  );
}
