import type { Metadata } from 'next';
import { CustomerShell } from '../../../../components/customer-shell';
import { CustomerFamilyInvitation } from '../../../../features/family/CustomerFamilyInvitation';

export const metadata: Metadata = {
  title: 'دعوت خانواده | فانتینو',
  referrer: 'no-referrer',
};

export default async function FamilyInvitationRoute({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return (
    <CustomerShell locale={locale}>
      <CustomerFamilyInvitation />
    </CustomerShell>
  );
}
