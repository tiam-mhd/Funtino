'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { SystemFormsManagement } from '../../../../features/forms/SystemFormsManagement';

export default function FormsManagementLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const view = pathname.includes('/forms/templates') ? 'templates' : 'forms';
  return (
    <>
      <SystemFormsManagement view={view} />
      {children}
    </>
  );
}
