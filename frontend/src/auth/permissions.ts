import type { MeDto } from '../api/types';

export function hasPermission(me: MeDto | undefined, permission: string): boolean {
  if (!me) return false;
  return me.isSuperuser || me.permissions.includes(permission);
}
