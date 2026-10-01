import { Navigate, Outlet } from 'react-router';
import { ApiError } from '../api/client';
import { PATHS } from '../app/paths';
import { FullPageLoader } from '../components/FullPageLoader';
import { LoadError } from '../components/TableStates';
import { Container } from '@mantine/core';
import { useMe } from './useMe';

export function RequireAuth() {
  const { data: me, isPending, isError, error, refetch } = useMe();

  if (isPending) return <FullPageLoader />;
  if (isError) {
    if (error instanceof ApiError && error.status === 401) return <Navigate to={PATHS.login} replace />;
    return (
      <Container size="sm" py="xl">
        <LoadError error={error} onRetry={() => void refetch()} />
      </Container>
    );
  }
  if (!me.mfaSatisfied) {
    return <Navigate to={me.twoFactorEnabled ? PATHS.loginTwoFactor : PATHS.twoFactorSetup} replace />;
  }
  return <Outlet />;
}
