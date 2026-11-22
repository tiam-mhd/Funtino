import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EDGE_OPERATOR_PERMISSIONS } from '../src/application/edge-operator-token.service.js';
import { accessRoleTemplates } from '../src/domain/authorization/role-templates.js';
import {
  permissionCatalog,
  permissionCatalogVersion,
} from '../src/domain/authorization/permission-catalog.js';

test('card balance permission is separate, scoped, and not granted by default role or Edge templates', () => {
  const permission = permissionCatalog.find((entry) => entry.key === 'card.balance.read');
  assert.equal(permissionCatalogVersion, 9);
  assert.deepEqual(permission?.scopes, ['branch', 'organization', 'global']);
  assert.equal(permission?.delegable, true);
  assert.equal(permission?.stepUp, false);
  assert.equal(EDGE_OPERATOR_PERMISSIONS.includes('card.balance.read' as never), false);
  for (const role of accessRoleTemplates) {
    assert.equal(role.permissionKeys.includes('card.balance.read'), false, role.key);
  }
});
