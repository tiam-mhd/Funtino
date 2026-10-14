import { redirect } from 'next/navigation';

export default function MfaPage() {
  redirect('/fa/security/mfa');
}
