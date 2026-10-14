'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { AccessManagement } from '../../../../features/access-control/AccessManagement';

type AccessView = 'received' | 'issued' | 'roles' | 'staff' | 'audit';

function accessViewFromPath(pathname: string): AccessView {
  if (pathname.includes('/access/invitations/received')) return 'received';
  if (pathname.includes('/access/invitations/issued')) return 'issued';
  if (pathname.includes('/access/roles/')) return 'roles';
  if (pathname.endsWith('/access/roles')) return 'roles';
  if (pathname.endsWith('/access/audit') || pathname.includes('/access/audit/')) return 'audit';
  return 'staff';
}

export default function AccessManagementLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <>
      <AccessManagement view={accessViewFromPath(pathname)} />
      {children}
    </>
  );
}
