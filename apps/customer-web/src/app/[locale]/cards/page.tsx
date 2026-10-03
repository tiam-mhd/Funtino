import { CardsPage } from '../../../components/customer-pages';
import { CustomerShell } from '../../../components/customer-shell';
import { readLocale } from '../../../lib/locale';

export default async function CardsRoute({
  params,
}: Readonly<{ params: Promise<{ locale: string }> }>) {
  const locale = await readLocale(params);

  return (
    <CustomerShell locale={locale}>
      <CardsPage />
    </CustomerShell>
  );
}
