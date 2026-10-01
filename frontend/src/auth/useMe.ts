import { useQuery } from '@tanstack/react-query';
import { authApi } from '../api/auth';

export const ME_QUERY_KEY = ['auth', 'me'] as const;

export function useMe() {
  return useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: authApi.me,
    retry: false,
    staleTime: 60_000,
  });
}
