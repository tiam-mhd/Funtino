import { CustomerAccount } from '../../../components/customer-account';
import { CustomerShell } from '../../../components/customer-shell';
import { readLocale } from '../../../lib/locale';

export default async function AccountRoute({
  params,
}: Readonly<{ params: Promise<{ locale: string }> }>) {
  const locale = await readLocale(params);

  return (
    <CustomerShell locale={locale}>
      <CustomerAccount locale={locale} />
    </CustomerShell>
  );
}
