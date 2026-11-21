export function isCustomerProfileOwnerEnabled(): boolean {
  return process.env.CUSTOMER_PROFILE_OWNER_ENABLED === 'true';
}
