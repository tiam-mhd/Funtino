import { MissionsPage } from '../../../components/customer-pages';
import { CustomerShell } from '../../../components/customer-shell';
import { readLocale } from '../../../lib/locale';

export default async function MissionsRoute({
  params,
}: Readonly<{ params: Promise<{ locale: string }> }>) {
  const locale = await readLocale(params);

  return (
    <CustomerShell locale={locale}>
      <MissionsPage />
    </CustomerShell>
  );
}
