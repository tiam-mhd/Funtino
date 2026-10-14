'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import {
  CustomerFamilySupport,
  type CustomerFamilyView,
} from '../../../features/customer-family/CustomerFamilySupport';
import { useOperationsWorkspace } from '../../../features/branch-scope/OperationsWorkspaceContext';

export default function OperationsFamilyLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const path = pathname.replace(/\/$/, '');
  const { activeScope, scopeOptions } = useOperationsWorkspace();
  const view: CustomerFamilyView = path.endsWith('/members')
    ? 'members'
    : path.endsWith('/invitations')
      ? 'invitations'
      : path.endsWith('/history')
        ? 'history'
        : 'lookup';

  return (
    <>
      <CustomerFamilySupport scope={activeScope.scope} scopeOptions={scopeOptions} view={view} />
      {children}
    </>
  );
}
