import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertAdministratorRemains,
  evaluateAuthorization,
  evaluateAuthorizationAcrossMemberships,
  evaluateDelegation,
  hasEffectivePermissionWithoutStepUp,
  type AccessScope,
  type AuthorizationContext,
  type PermissionOverride,
} from '../src/domain/authorization/authorization-evaluator.js';
import { getPermissionDefinition } from '../src/domain/authorization/permission-catalog.js';
import { accessRoleTemplates } from '../src/domain/authorization/role-templates.js';

const organizationScope: AccessScope = { type: 'organization', organizationId: 'org-a' };
const otherOrganizationScope: AccessScope = { type: 'organization', organizationId: 'org-b' };
const branchScope: AccessScope = {
  type: 'branch',
  organizationId: 'org-a',
  branchId: 'branch-a',
};
const otherBranchScope: AccessScope = {
  type: 'branch',
  organizationId: 'org-a',
  branchId: 'branch-b',
};
const fixedNow = new Date('2026-09-28T10:00:00.000Z');

test('system telemetry permission is global-only and included in the read-only support template', () => {
  const definition = getPermissionDefinition('system.health.read');
  assert.deepEqual(definition?.scopes, ['global']);
  assert.equal(definition?.delegable, true);
  assert.equal(definition?.stepUp, false);
  assert.ok(
    accessRoleTemplates
      .find((template) => template.key === 'system_support')
      ?.permissionKeys.includes('system.health.read'),
  );
});

test('family support is independently scoped and limited to CRM/read-only support templates', () => {
  const family = getPermissionDefinition('customer.family.read');
  assert.deepEqual(family?.scopes, ['branch', 'organization', 'global']);
  assert.equal(family?.stepUp, false);
  assert.equal(family?.delegable, true);
  for (const key of ['system_support', 'organization_crm_manager', 'branch_crm_manager']) {
    assert.ok(
      accessRoleTemplates
        .find((template) => template.key === key)
        ?.permissionKeys.includes('customer.family.read'),
    );
  }
  for (const key of [
    'organization_manager',
    'branch_manager',
    'branch_cashier',
    'branch_operator',
    'organization_support',
    'branch_support',
  ]) {
    assert.equal(
      accessRoleTemplates
        .find((template) => template.key === key)
        ?.permissionKeys.includes('customer.family.read'),
      false,
    );
  }
});

test('Forms PII access is a separate read permission and is absent from default tenant roles', () => {
  const pii = getPermissionDefinition('forms.responses.pii.read');
  assert.deepEqual(pii?.scopes, ['branch', 'organization']);
  assert.equal(pii?.delegable, true);
  assert.equal(pii?.stepUp, false);

  for (const template of accessRoleTemplates.filter((item) =>
    [
      'organization_manager',
      'branch_manager',
      'organization_crm_manager',
      'branch_crm_manager',
    ].includes(item.key),
  )) {
    assert.equal(template.permissionKeys.includes('forms.responses.pii.read'), false);
  }
  assert.ok(
    accessRoleTemplates
      .find((item) => item.key === 'branch_manager')
      ?.permissionKeys.includes('forms.manage'),
  );
  assert.ok(
    accessRoleTemplates
      .find((item) => item.key === 'organization_crm_manager')
      ?.permissionKeys.includes('forms.responses.read'),
  );
});

test('response correction is separately scoped and does not grant PII access', () => {
  const correction = getPermissionDefinition('forms.responses.correct');
  assert.deepEqual(correction?.scopes, ['branch', 'organization']);
  assert.equal(correction?.stepUp, true);
  for (const template of accessRoleTemplates.filter((item) =>
    ['organization_manager', 'branch_manager'].includes(item.key),
  )) {
    assert.ok(template.permissionKeys.includes('forms.responses.correct'));
    assert.equal(template.permissionKeys.includes('forms.responses.pii.read'), false);
  }
});

test('only the approved high-risk permission catalog requires routine step-up', () => {
  const stepUpKeys = [
    'organization.create',
    'branch.deactivate',
    'access.role.manage',
    'access.permission.delegate',
    'system.access.bootstrap',
    'system.access.impersonate',
    'report.export',
    'forms.platform.manage',
    'forms.responses.correct',
    'forms.responses.export',
  ];
  for (const key of stepUpKeys) assert.equal(getPermissionDefinition(key)?.stepUp, true, key);
  for (const key of [
    'organization.read',
    'organization.update',
    'branch.create',
    'branch.update',
    'staff.read',
    'staff.invite',
    'staff.suspend',
    'staff.reactivate',
    'device.register',
    'device.maintenance.manage',
    'card.inventory.manage',
    'card.assign',
    'card.transfer',
    'card.unassign',
    'customer.lookup.limited',
    'customer.family.read',
    'report.read',
    'audit.read',
    'system.session_policy.manage',
    'forms.publish',
    'forms.responses.manage',
    'forms.responses.pii.read',
    'forms.templates.manage',
  ]) {
    assert.equal(getPermissionDefinition(key)?.stepUp, false, key);
  }
});

function makeContext(overrides: readonly PermissionOverride[] = []): AuthorizationContext {
  return {
    actorUserId: 'user-a',
    membership: {
      id: 'membership-a',
      userId: 'user-a',
      status: 'active',
      scope: organizationScope,
    },
    role: {
      id: 'organization-manager',
      status: 'active',
      scope: organizationScope,
      permissions: [
        'branch.read',
        'access.role.manage',
        'access.permission.delegate',
        'report.read',
      ],
    },
    overrides,
    policyVersion: 8,
    mfaVerifiedAt: fixedNow,
  };
}

function makeOverride(
  effect: PermissionOverride['effect'],
  overrides: Partial<PermissionOverride> = {},
): PermissionOverride {
  return {
    id: 'override-a',
    membershipId: 'membership-a',
    permission: 'report.read',
    effect,
    scope: organizationScope,
    startsAt: new Date('2026-09-01T00:00:00.000Z'),
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  };
}

test('allows role permission only inside its organization scope', () => {
  const context = makeContext();
  const allowed = evaluateAuthorization(context, { permission: 'branch.read', scope: branchScope });
  const denied = evaluateAuthorization(context, {
    permission: 'branch.read',
    scope: otherOrganizationScope,
  });

  assert.equal(allowed.allowed, true);
  assert.equal(allowed.reason, 'role_permission');
  assert.equal(allowed.policyVersion, 8);
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, 'scope_invalid');
});

test('an explicit membership deny overrides both role permission and personal allow', () => {
  const context = makeContext([makeOverride('allow'), makeOverride('deny', { id: 'deny-a' })]);
  const result = evaluateAuthorization(context, {
    permission: 'report.read',
    scope: organizationScope,
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'user_deny_override');
});

test('a branch-level deny cannot suppress an independent organization-level grant', () => {
  const organizationMember = makeContext();
  organizationMember.role.permissions = ['report.read'];
  const branchMember = makeContext([
    makeOverride('deny', {
      membershipId: 'membership-branch',
      scope: branchScope,
    }),
  ]);
  branchMember.membership.id = 'membership-branch';
  branchMember.membership.scope = branchScope;
  branchMember.role.scope = branchScope;
  branchMember.role.permissions = [];

  const result = evaluateAuthorizationAcrossMemberships(
    [organizationMember, branchMember],
    { permission: 'report.read', scope: branchScope },
    8,
    { now: fixedNow },
  );

  assert.equal(result.allowed, true);
  assert.equal(result.reason, 'role_permission');
  assert.equal(result.policyVersion, 8);
});

test('a branch-level deny blocks same-scope grants when no broader grant exists', () => {
  const branchMember = makeContext([
    makeOverride('deny', { membershipId: 'membership-branch', scope: branchScope }),
  ]);
  branchMember.membership.id = 'membership-branch';
  branchMember.membership.scope = branchScope;
  branchMember.role.scope = branchScope;
  branchMember.role.permissions = ['report.read'];

  const result = evaluateAuthorizationAcrossMemberships(
    [branchMember],
    { permission: 'report.read', scope: branchScope },
    8,
    { now: fixedNow },
  );

  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'user_deny_override');
});

test('an organization deny blocks branch grants but cannot suppress a global grant', () => {
  const organizationDeny = makeContext([makeOverride('deny', { scope: organizationScope })]);
  organizationDeny.role.permissions = [];

  const branchGrant = makeContext();
  branchGrant.membership.id = 'membership-branch';
  branchGrant.membership.scope = branchScope;
  branchGrant.role.scope = branchScope;
  branchGrant.role.permissions = ['report.read'];

  const branchDenied = evaluateAuthorizationAcrossMemberships(
    [organizationDeny, branchGrant],
    { permission: 'report.read', scope: branchScope },
    8,
    { now: fixedNow },
  );
  assert.equal(branchDenied.allowed, false);
  assert.equal(branchDenied.reason, 'user_deny_override');

  const globalGrant = makeContext();
  globalGrant.membership.id = 'membership-global';
  globalGrant.membership.scope = { type: 'global' };
  globalGrant.role.scope = { type: 'global' };
  globalGrant.role.permissions = ['report.read'];
  const globalAllowed = evaluateAuthorizationAcrossMemberships(
    [organizationDeny, branchGrant, globalGrant],
    { permission: 'report.read', scope: branchScope },
    8,
    { now: fixedNow },
  );
  assert.equal(globalAllowed.allowed, true);
  assert.equal(globalAllowed.reason, 'role_permission');
});

test('an explicit global deny still blocks every descendant grant', () => {
  const globalDeny = makeContext([
    makeOverride('deny', {
      membershipId: 'membership-global',
      scope: { type: 'global' },
    }),
  ]);
  globalDeny.membership.id = 'membership-global';
  globalDeny.membership.scope = { type: 'global' };
  globalDeny.role.scope = { type: 'global' };
  globalDeny.role.permissions = [];

  const organizationGrant = makeContext();
  organizationGrant.role.permissions = ['report.read'];
  const result = evaluateAuthorizationAcrossMemberships(
    [globalDeny, organizationGrant],
    { permission: 'report.read', scope: branchScope },
    8,
    { now: fixedNow },
  );

  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'user_deny_override');
});

test('administrator invariant checks use the same membership-scoped deny precedence', () => {
  const organizationGrant = makeContext();
  organizationGrant.role.permissions = ['report.read'];
  const branchDeny = makeContext([
    makeOverride('deny', { membershipId: 'membership-branch', scope: branchScope }),
  ]);
  branchDeny.membership.id = 'membership-branch';
  branchDeny.membership.scope = branchScope;
  branchDeny.role.scope = branchScope;
  branchDeny.role.permissions = [];

  assert.equal(
    hasEffectivePermissionWithoutStepUp(
      [organizationGrant, branchDeny],
      { permission: 'report.read', scope: branchScope },
      8,
      fixedNow,
    ),
    true,
  );
});

test('a deny remains effective within its membership when its role is disabled', () => {
  const organizationMember = makeContext();
  organizationMember.role.permissions = ['report.read'];
  const branchMember = makeContext([
    makeOverride('deny', {
      membershipId: 'membership-branch',
      scope: branchScope,
    }),
  ]);
  branchMember.membership.id = 'membership-branch';
  branchMember.membership.scope = branchScope;
  branchMember.role.scope = branchScope;
  branchMember.role.status = 'disabled';
  branchMember.role.permissions = [];

  const ownDecision = evaluateAuthorization(branchMember, {
    permission: 'report.read',
    scope: branchScope,
  });
  assert.equal(ownDecision.allowed, false);
  assert.equal(ownDecision.reason, 'user_deny_override');

  const result = evaluateAuthorizationAcrossMemberships(
    [organizationMember, branchMember],
    { permission: 'report.read', scope: branchScope },
    8,
    { now: fixedNow },
  );

  assert.equal(result.allowed, true);
  assert.equal(result.reason, 'role_permission');
});

test('a suspended membership deny does not suppress another active membership grant', () => {
  const organizationGrant = makeContext();
  organizationGrant.role.permissions = ['report.read'];
  const suspendedBranchDeny = makeContext([
    makeOverride('deny', { membershipId: 'membership-branch', scope: branchScope }),
  ]);
  suspendedBranchDeny.membership.id = 'membership-branch';
  suspendedBranchDeny.membership.scope = branchScope;
  suspendedBranchDeny.membership.status = 'suspended';
  suspendedBranchDeny.role.scope = branchScope;
  suspendedBranchDeny.role.permissions = [];

  const result = evaluateAuthorizationAcrossMemberships(
    [organizationGrant, suspendedBranchDeny],
    { permission: 'report.read', scope: branchScope },
    8,
    { now: fixedNow },
  );
  assert.equal(result.allowed, true);
  assert.equal(result.reason, 'role_permission');
});

test('a personal allow applies only to its membership and exact resource when constrained', () => {
  const context = makeContext([
    makeOverride('allow', {
      permission: 'device.health.read',
      scope: branchScope,
      resource: { type: 'device', id: 'device-a' },
    }),
  ]);
  const allowed = evaluateAuthorization(context, {
    permission: 'device.health.read',
    scope: branchScope,
    resource: { type: 'device', id: 'device-a' },
  });
  const otherResource = evaluateAuthorization(context, {
    permission: 'device.health.read',
    scope: branchScope,
    resource: { type: 'device', id: 'device-b' },
  });
  const wrongMembership = makeContext([
    makeOverride('allow', {
      membershipId: 'membership-b',
      permission: 'device.health.read',
      scope: branchScope,
      resource: { type: 'device', id: 'device-a' },
    }),
  ]);

  assert.equal(allowed.allowed, true);
  assert.equal(allowed.reason, 'user_allow_override');
  assert.equal(otherResource.allowed, false);
  assert.equal(
    evaluateAuthorization(wrongMembership, {
      permission: 'device.health.read',
      scope: branchScope,
      resource: { type: 'device', id: 'device-a' },
    }).allowed,
    false,
  );
});

test('expired, not-yet-active, and revoked overrides do not grant access', () => {
  for (const candidate of [
    makeOverride('allow', { startsAt: new Date('2026-09-29T00:00:00.000Z') }),
    makeOverride('allow', { expiresAt: fixedNow }),
    makeOverride('allow', { revokedAt: new Date('2026-09-27T00:00:00.000Z') }),
  ]) {
    const context = makeContext([candidate]);
    const result = evaluateAuthorization(
      context,
      { permission: 'device.health.read', scope: branchScope },
      { now: fixedNow },
    );
    assert.equal(result.allowed, false);
    assert.equal(result.reason, 'permission_not_granted');
  }
});

test('membership suspension, actor mismatch, and disabled roles fail closed', () => {
  const suspended = makeContext();
  suspended.membership.status = 'suspended';
  const mismatchedActor = makeContext();
  mismatchedActor.actorUserId = 'user-b';
  const disabledRole = makeContext();
  disabledRole.role.status = 'disabled';

  assert.equal(
    evaluateAuthorization(suspended, { permission: 'branch.read', scope: branchScope }).reason,
    'membership_inactive',
  );
  assert.equal(
    evaluateAuthorization(mismatchedActor, { permission: 'branch.read', scope: branchScope })
      .reason,
    'actor_mismatch',
  );
  assert.equal(
    evaluateAuthorization(disabledRole, { permission: 'branch.read', scope: branchScope }).reason,
    'role_inactive',
  );
});

test('branch membership cannot reach another branch or an organization-wide resource', () => {
  const context = makeContext();
  context.membership.scope = branchScope;
  context.role.scope = organizationScope;

  assert.equal(
    evaluateAuthorization(context, { permission: 'branch.read', scope: branchScope }).allowed,
    true,
  );
  assert.equal(
    evaluateAuthorization(context, { permission: 'branch.read', scope: otherBranchScope }).reason,
    'scope_invalid',
  );
  assert.equal(
    evaluateAuthorization(context, { permission: 'organization.read', scope: organizationScope })
      .reason,
    'scope_invalid',
  );
});

test('unknown permissions and invalid policy versions are denied', () => {
  const unknown = evaluateAuthorization(makeContext(), {
    permission: 'organization.delete',
    scope: organizationScope,
  });
  const context = makeContext();
  context.policyVersion = 0;
  const invalidVersion = evaluateAuthorization(context, {
    permission: 'branch.read',
    scope: branchScope,
  });

  assert.equal(unknown.reason, 'permission_unknown');
  assert.equal(invalidVersion.reason, 'policy_version_invalid');
  assert.equal(
    evaluateAuthorization(
      makeContext(),
      { permission: 'branch.read', scope: branchScope },
      { now: new Date('invalid') },
    ).reason,
    'evaluation_time_invalid',
  );
});

test('step-up permissions fail closed until MFA freshness policy is configured', () => {
  const request = { permission: 'access.role.manage', scope: organizationScope };
  const context = makeContext();

  assert.equal(evaluateAuthorization(context, request).reason, 'step_up_policy_unconfigured');
  assert.equal(
    evaluateAuthorization(context, request, {
      now: fixedNow,
      mfaFreshnessSeconds: 300,
    }).allowed,
    true,
  );
  context.mfaVerifiedAt = new Date('2026-09-28T09:00:00.000Z');
  assert.equal(
    evaluateAuthorization(context, request, {
      now: fixedNow,
      mfaFreshnessSeconds: 300,
    }).reason,
    'step_up_required',
  );
  context.mfaVerifiedAt = new Date('invalid');
  assert.equal(
    evaluateAuthorization(context, request, {
      now: fixedNow,
      mfaFreshnessSeconds: 300,
    }).reason,
    'step_up_required',
  );
});

test('a command can require step-up without making the shared permission read sensitive', () => {
  const context = makeContext();
  context.role.permissions = ['staff.suspend'];
  const request = { permission: 'staff.suspend', scope: organizationScope };
  assert.equal(
    evaluateAuthorization(context, request, { now: fixedNow, mfaFreshnessSeconds: 300 }).allowed,
    true,
  );
  assert.equal(
    evaluateAuthorization(context, request, {
      now: fixedNow,
      mfaFreshnessSeconds: 300,
      forceStepUp: true,
    }).allowed,
    true,
  );
  context.mfaVerifiedAt = null;
  assert.equal(
    evaluateAuthorization(context, request, {
      now: fixedNow,
      mfaFreshnessSeconds: 300,
      forceStepUp: true,
    }).reason,
    'step_up_required',
  );
});

test('delegation is clipped to permissions the actor can exercise and delegate', () => {
  const context = makeContext();
  const permitted = evaluateDelegation(context, ['branch.read'], organizationScope, {
    now: fixedNow,
    mfaFreshnessSeconds: 300,
  });
  const escalation = evaluateDelegation(context, ['organization.create'], organizationScope, {
    now: fixedNow,
    mfaFreshnessSeconds: 300,
  });
  const globalOnly = evaluateDelegation(context, ['system.access.bootstrap'], organizationScope, {
    now: fixedNow,
    mfaFreshnessSeconds: 300,
  });

  assert.equal(permitted.allowed, true);
  assert.equal(escalation.allowed, false);
  assert.equal(globalOnly.allowed, false);
});

test('last active administrator cannot be removed', () => {
  assertAdministratorRemains(1);
  assert.throws(() => assertAdministratorRemains(0), {
    message: 'LAST_ACTIVE_ADMINISTRATOR_REQUIRED',
  });
  assert.throws(() => assertAdministratorRemains(Number.NaN));
});
