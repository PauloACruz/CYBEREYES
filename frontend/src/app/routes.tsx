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
