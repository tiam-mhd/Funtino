import { CustomerProfile } from '../../../../components/customer-profile';
import { CustomerShell } from '../../../../components/customer-shell';
import { readLocale } from '../../../../lib/locale';

export default async function CustomerProfileRoute({
  params,
}: Readonly<{ params: Promise<{ locale: string }> }>) {
  const locale = await readLocale(params);

  return (
    <CustomerShell locale={locale}>
      <CustomerProfile />
    </CustomerShell>
  );
}
