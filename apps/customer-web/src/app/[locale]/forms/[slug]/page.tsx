import { notFound } from 'next/navigation';
import { CustomerPublicForm } from '../../../../components/customer-forms';
import { readLocale } from '../../../../lib/locale';

export default async function CustomerPublicFormPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const [{ locale, slug }, parameters] = await Promise.all([params, searchParams]);
  const resolvedLocale = await readLocale(Promise.resolve({ locale }));
  let decodedSlug: string;
  try {
    // Normalize the route segment before the API client encodes it for its request path.
    decodedSlug = decodeURIComponent(slug);
  } catch {
    notFound();
  }
  const linkParameters = Object.fromEntries(
    (['source', 'campaign', 'ref'] as const).map((key) => {
      const value = parameters[key];
      return [key, typeof value === 'string' ? value.slice(0, 160) : undefined];
    }),
  );
  return <CustomerPublicForm locale={resolvedLocale} slug={decodedSlug} linkParameters={linkParameters} />;
}
