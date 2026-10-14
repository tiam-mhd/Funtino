'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { OperationsScope, OperationsScopeOption } from '../../lib/auth/operations-access';
import type { WorkspaceSection } from '../../components/workspace-shell/OperationsWorkspaceShell';

export type OperationsWorkspaceContextValue = {
  activeScope: OperationsScopeOption;
  scopeOptions: OperationsScopeOption[];
  mfaStepUpUntil: number | null;
  onSessionExpired: () => void;
  onSelectScope: (scope: OperationsScope) => void | Promise<void>;
  onMfaStepUp: (validUntil: number) => void;
  refreshScopesAfterInvitation: () => Promise<void>;
  navigate: (section: WorkspaceSection) => void;
};

const OperationsWorkspaceContext = createContext<OperationsWorkspaceContextValue | null>(null);

export function OperationsWorkspaceProvider({
  value,
  children,
}: {
  value: OperationsWorkspaceContextValue;
  children: ReactNode;
}) {
  return (
    <OperationsWorkspaceContext.Provider value={value}>
      {children}
    </OperationsWorkspaceContext.Provider>
  );
}

export function useOperationsWorkspace() {
  const value = useContext(OperationsWorkspaceContext);
  if (!value) throw new Error('Operations workspace context is unavailable outside its layout.');
  return value;
}
