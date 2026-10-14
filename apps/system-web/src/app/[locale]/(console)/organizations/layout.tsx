'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { OrganizationsManagement } from '../../../../features/organizations/OrganizationsManagement';

export default function OrganizationManagementLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const view = pathname.includes('/organizations/branches') ? 'branches' : 'organizations';
  return (
    <>
      <OrganizationsManagement view={view} />
      {children}
    </>
  );
}
