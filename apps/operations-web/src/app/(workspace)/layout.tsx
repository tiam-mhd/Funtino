import type { ReactNode } from 'react';
import { OperationsEntry } from '../../features/branch-scope/OperationsEntry';

export default function OperationsWorkspaceLayout({ children }: { children: ReactNode }) {
  return <OperationsEntry>{children}</OperationsEntry>;
}
