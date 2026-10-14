import type { ReactNode } from 'react';
import { ManagementAuthGate } from '../../../features/security/ManagementAuthGate';

export default function ManagementConsoleLayout({ children }: { children: ReactNode }) {
  return <ManagementAuthGate>{children}</ManagementAuthGate>;
}
