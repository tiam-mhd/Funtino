import { CustomerFormsList } from '../../../components/customer-forms';
import { readLocale } from '../../../lib/locale';

export default async function CustomerFormsPage({ params }: Readonly<{ params: Promise<{ locale: string }> }>) {
  const locale = await readLocale(params);
  return <CustomerFormsList locale={locale} />;
}
