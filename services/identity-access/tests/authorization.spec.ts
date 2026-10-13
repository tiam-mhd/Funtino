import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertAdministratorRemains,
  evaluateAuthorization,
  evaluateAuthorizationAcrossMemberships,
  evaluateDelegation,
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

test('family support is independently scoped, step-up protected, and limited to CRM/read-only support templates', () => {
  const family = getPermissionDefinition('customer.family.read');
  assert.deepEqual(family?.scopes, ['branch', 'organization', 'global']);
  assert.equal(family?.stepUp, true);
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

test('Forms PII access is a separate step-up permission and is absent from default tenant roles', () => {
  const pii = getPermissionDefinition('forms.responses.pii.read');
  assert.deepEqual(pii?.scopes, ['branch', 'organization']);
  assert.equal(pii?.delegable, true);
  assert.equal(pii?.stepUp, true);

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
  assert.equal(correction?.stepUp, false);
  for (const template of accessRoleTemplates.filter((item) =>
    ['organization_manager', 'branch_manager'].includes(item.key),
  )) {
    assert.ok(template.permissionKeys.includes('forms.responses.correct'));
    assert.equal(template.permissionKeys.includes('forms.responses.pii.read'), false);
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
    policyVersion: 7,
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
  assert.equal(allowed.policyVersion, 7);
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

test('a branch-level deny overrides a grant inherited from an organization membership', () => {
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

  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'user_deny_override');
  assert.equal(result.policyVersion, 8);
});

test('a deny override remains effective even if its role is disabled', () => {
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

  const result = evaluateAuthorizationAcrossMemberships(
    [organizationMember, branchMember],
    { permission: 'report.read', scope: branchScope },
    9,
    { now: fixedNow },
  );

  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'user_deny_override');
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

test('sensitive permissions fail closed until MFA freshness policy is configured', () => {
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
