'use client';

import { useParams } from 'next/navigation';
import { StaffMemberDetails } from '../../../../../features/staff-access/StaffMemberDetails';

export default function StaffMemberDetailsPage() {
  const params = useParams<{ membershipId: string }>();
  return <StaffMemberDetails membershipId={params.membershipId} />;
}
