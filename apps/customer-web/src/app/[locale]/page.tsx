import { CustomerHome } from '../../components/customer-home';
import { CustomerShell } from '../../components/customer-shell';
import { readLocale } from '../../lib/locale';

export default async function CustomerHomeRoute({
  params,
}: Readonly<{ params: Promise<{ locale: string }> }>) {
  const locale = await readLocale(params);

  return (
    <CustomerShell locale={locale}>
      <CustomerHome locale={locale} />
    </CustomerShell>
  );
}
