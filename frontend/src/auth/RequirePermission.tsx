import { Outlet } from 'react-router';
import { AccessDenied } from '../components/AccessDenied';
import { hasPermission } from './permissions';
import { useMe } from './useMe';

interface RequirePermissionProps {
  permission: string;
}

/** Usado dentro de RequireAuth, quando o MeDto ja esta em cache. */
export function RequirePermission({ permission }: RequirePermissionProps) {
  const { data: me } = useMe();
  if (!hasPermission(me, permission)) return <AccessDenied />;
  return <Outlet />;
}
