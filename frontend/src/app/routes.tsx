import type { RouteObject } from 'react-router';
import { PERMISSIONS } from '../api/types';
import { RequireAuth } from '../auth/RequireAuth';
import { RequirePermission } from '../auth/RequirePermission';
import { AppLayout } from '../components/layout/AppLayout';
import { NotFound } from '../components/NotFound';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { LoginPage } from '../features/auth/LoginPage';
import { TwoFactorPage } from '../features/auth/TwoFactorPage';
import { TwoFactorSetupPage } from '../features/auth/TwoFactorSetupPage';
import { PATHS } from './paths';

export const routes: RouteObject[] = [
  { path: PATHS.login, element: <LoginPage /> },
  { path: PATHS.loginTwoFactor, element: <TwoFactorPage /> },
  { path: PATHS.twoFactorSetup, element: <TwoFactorSetupPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <DashboardPage /> },
          {
            element: <RequirePermission permission={PERMISSIONS.agentsView} />,
            children: [
              {
                path: PATHS.agents,
                lazy: () => import('../features/agents/AgentsPage').then((m) => ({ Component: m.AgentsPage })),
              },
              {
                path: `${PATHS.agents}/:id`,
                lazy: () => import('../features/agents/AgentDetailPage').then((m) => ({ Component: m.AgentDetailPage })),
              },
              {
                path: PATHS.policies,
                lazy: () => import('../features/policies/PoliciesPage').then((m) => ({ Component: m.PoliciesPage })),
              },
              {
                path: PATHS.policyAssignments,
                lazy: () => import('../features/policies/PolicyAssignmentsPage').then((m) => ({ Component: m.PolicyAssignmentsPage })),
              },
              {
                path: `${PATHS.policies}/:id`,
                lazy: () => import('../features/policies/PolicyDetailPage').then((m) => ({ Component: m.PolicyDetailPage })),
              },
            ],
          },
          {
            element: <RequirePermission permission={PERMISSIONS.alertsView} />,
            children: [
              {
                path: PATHS.alerts,
                lazy: () => import('../features/alerts/AlertsPage').then((m) => ({ Component: m.AlertsPage })),
              },
            ],
          },
          {
            element: <RequirePermission permission={PERMISSIONS.alertsManage} />,
            children: [
              {
                path: PATHS.alertTemplates,
                lazy: () => import('../features/alerts/AlertTemplatesPage').then((m) => ({ Component: m.AlertTemplatesPage })),
              },
            ],
          },
          {
            element: <RequirePermission permission={PERMISSIONS.ticketsView} />,
            children: [
              {
                path: PATHS.tickets,
                lazy: () => import('../features/tickets/TicketsPage').then((m) => ({ Component: m.TicketsPage })),
              },
              {
                path: `${PATHS.tickets}/:id`,
                lazy: () => import('../features/tickets/TicketDetailPage').then((m) => ({ Component: m.TicketDetailPage })),
              },
            ],
          },
          {
            element: <RequirePermission permission={PERMISSIONS.scriptsView} />,
            children: [
              {
                path: PATHS.scripts,
                lazy: () => import('../features/scripts/ScriptsPage').then((m) => ({ Component: m.ScriptsPage })),
              },
            ],
          },
          {
            element: <RequirePermission permission={PERMISSIONS.settingsManage} />,
            children: [
              {
                path: PATHS.settings,
                lazy: () => import('../features/settings/SettingsPage').then((m) => ({ Component: m.SettingsPage })),
              },
            ],
          },
          {
            element: <RequirePermission permission={PERMISSIONS.clientsView} />,
            children: [
              {
                path: PATHS.clients,
                lazy: () => import('../features/clients/ClientsPage').then((m) => ({ Component: m.ClientsPage })),
              },
            ],
          },
          {
            element: <RequirePermission permission={PERMISSIONS.agentsInstall} />,
            children: [
              {
                path: PATHS.deployments,
                lazy: () => import('../features/deployments/DeploymentsPage').then((m) => ({ Component: m.DeploymentsPage })),
              },
            ],
          },
          {
            element: <RequirePermission permission={PERMISSIONS.usersView} />,
            children: [
              {
                path: PATHS.users,
                lazy: () => import('../features/users/UsersPage').then((m) => ({ Component: m.UsersPage })),
              },
            ],
          },
          {
            element: <RequirePermission permission={PERMISSIONS.rolesManage} />,
            children: [
              {
                path: PATHS.roles,
                lazy: () => import('../features/roles/RolesPage').then((m) => ({ Component: m.RolesPage })),
              },
            ],
          },
          {
            element: <RequirePermission permission={PERMISSIONS.apiKeysManage} />,
            children: [
              {
                path: PATHS.apiKeys,
                lazy: () => import('../features/apikeys/ApiKeysPage').then((m) => ({ Component: m.ApiKeysPage })),
              },
            ],
          },
          {
            element: <RequirePermission permission={PERMISSIONS.auditView} />,
            children: [
              {
                path: PATHS.audit,
                lazy: () => import('../features/audit/AuditPage').then((m) => ({ Component: m.AuditPage })),
              },
            ],
          },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
];
