'use client';

import { useParams } from 'next/navigation';
import { StaffRoleDetails } from '../../../../../features/staff-access/StaffRoleDetails';

export default function StaffRoleDetailsPage() {
  const params = useParams<{ roleId: string }>();
  return <StaffRoleDetails roleId={params.roleId} />;
}
