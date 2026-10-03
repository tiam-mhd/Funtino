export const HOUSEHOLD_VALIDATOR = Symbol('HOUSEHOLD_VALIDATOR');

export interface HouseholdValidator {
  assertActiveHousehold(householdId: string): Promise<void>;
}
