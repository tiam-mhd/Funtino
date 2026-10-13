export function getCustomerFamilyPhoneHashSecret(
  secret = process.env.CUSTOMER_FAMILY_PHONE_HASH_SECRET,
): string | null {
  if (typeof secret !== 'string' || secret.length < 32 || secret.length > 512) {
    return null;
  }
  return secret;
}
