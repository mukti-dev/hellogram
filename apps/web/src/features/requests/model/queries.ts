import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { requestsApi } from '../api/requests.api.js';

export const requestKeys = {
  all: ['requests'] as const,
  list: (status: 'pending' | 'blocked') => ['requests', status] as const,
  count: ['requests', 'count'] as const,
};

export const useIncomingRequests = (status: 'pending' | 'blocked') =>
  useQuery({ queryKey: requestKeys.list(status), queryFn: () => requestsApi.incoming(status) });

export const usePendingCount = () =>
  useQuery({ queryKey: requestKeys.count, queryFn: requestsApi.count, select: (d) => d.count });

export function useRequestAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'accept' | 'decline' | 'block' }) =>
      action === 'accept'
        ? requestsApi.accept(id)
        : action === 'decline'
          ? requestsApi.decline(id).then(() => null)
          : requestsApi.block(id).then(() => null),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: requestKeys.all });
      void client.invalidateQueries({ queryKey: ['conversations'] });
      void client.invalidateQueries({ queryKey: ['blocks'] });
    },
  });
}

export const useBlocks = () => useQuery({ queryKey: ['blocks'], queryFn: requestsApi.blocks });

export function useUnblock() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: requestsApi.unblock,
    onSuccess: () => void client.invalidateQueries({ queryKey: ['blocks'] }),
  });
}
