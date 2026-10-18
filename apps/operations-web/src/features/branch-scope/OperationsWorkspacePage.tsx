'use client';

import { Surface } from '@funtino/design-system';
import type { WorkspaceSection } from '../../components/workspace-shell/OperationsWorkspaceShell';
import { OperationsBranchDirectory } from '../reports/OperationsBranchDirectory';
import { OperationsOverview } from '../reports/OperationsOverview';
import { OperationsReports } from '../reports/OperationsReports';
import { StaffAccessManager } from '../staff-access/StaffAccessManager';
import { StaffInvitationInbox } from '../staff-access/StaffInvitationInbox';
import { DeviceManagement } from '../devices/DeviceManagement';
import { CardInventoryManagement } from '../cashier/CardInventoryManagement';
import { OperationsForms } from '../forms/OperationsForms';
import { useOperationsWorkspace } from './OperationsWorkspaceContext';

export function OperationsWorkspacePage({ section }: { section: WorkspaceSection }) {
  const {
    activeScope,
    scopeOptions,
    mfaStepUpUntil,
    onSessionExpired,
    onSelectScope,
    onMfaStepUp,
    refreshScopesAfterInvitation,
    navigate,
  } = useOperationsWorkspace();
  const scope = activeScope.scope;

  if (
    (section === 'formsBranches' || section === 'reportsBranches') &&
    scope.type !== 'organization'
  ) {
    return (
      <UnsupportedScope message="مقایسه‌ی شعب فقط در محدوده‌ی یک مجموعه داده دارد؛ محدوده‌ی مجاز مجموعه را از سربرگ انتخاب کنید." />
    );
  }

  if (section === 'overview') {
    return (
      <OperationsOverview
        scope={scope}
        scopeOption={activeScope}
        onNavigate={navigate}
        onSessionExpired={onSessionExpired}
      />
    );
  }
  if (section === 'branches') {
    return scope.type === 'organization' ? (
      <OperationsBranchDirectory
        scope={scope}
        scopeOption={activeScope}
        onSelectScope={onSelectScope}
        onSessionExpired={onSessionExpired}
      />
    ) : (
      <UnsupportedScope message="فهرست شعب در محدوده‌ی یک مجموعه نمایش داده می‌شود؛ محدوده‌ی مجاز مجموعه را انتخاب کنید." />
    );
  }
  if (section === 'staff') {
    return (
      <StaffAccessManager
        onSessionExpired={onSessionExpired}
        scope={scope}
        scopeOptions={scopeOptions}
        view="roster"
      />
    );
  }
  if (section === 'staffRoles') {
    return (
      <StaffAccessManager
        onSessionExpired={onSessionExpired}
        scope={scope}
        scopeOptions={scopeOptions}
        view="roles"
      />
    );
  }
  if (section === 'invitationsIssued') {
    return (
      <StaffAccessManager
        onSessionExpired={onSessionExpired}
        scope={scope}
        scopeOptions={scopeOptions}
        view="invitations"
      />
    );
  }
  if (section === 'invitationsReceived') {
    return (
      <StaffInvitationInbox
        forceVisible
        onAccepted={refreshScopesAfterInvitation}
        onSessionExpired={onSessionExpired}
      />
    );
  }
  if (section === 'devices') {
    return (
      <DeviceManagement
        onSessionExpired={onSessionExpired}
        scope={scope}
        scopeOption={activeScope}
      />
    );
  }
  if (section === 'cardsInventory' || section === 'cardsAssignments') {
    return (
      <CardInventoryManagement
        onSessionExpired={onSessionExpired}
        scope={scope}
        scopeOption={activeScope}
        view={section === 'cardsAssignments' ? 'assignments' : 'inventory'}
      />
    );
  }
  if (section === 'formsLibrary' || section === 'formsResponses' || section === 'formsBranches') {
    return (
      <OperationsForms
        mfaStepUpUntil={mfaStepUpUntil}
        onMfaStepUp={onMfaStepUp}
        onSessionExpired={onSessionExpired}
        scope={scope}
        scopeOptions={scopeOptions}
        view={
          section === 'formsResponses'
            ? 'responses'
            : section === 'formsBranches'
              ? 'branches'
              : 'library'
        }
      />
    );
  }
  return (
    <OperationsReports
      mfaStepUpUntil={mfaStepUpUntil}
      onMfaStepUp={onMfaStepUp}
      onSessionExpired={onSessionExpired}
      scope={scope}
      view={
        section === 'reportsDaily'
          ? 'daily'
          : section === 'reportsBranches'
            ? 'branches'
            : 'summary'
      }
    />
  );
}

function UnsupportedScope({ message }: { message: string }) {
  return (
    <Surface role="status">
      <p>{message}</p>
    </Surface>
  );
}
