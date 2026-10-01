import type { OwnPersonaDto, PersonaListDto, UpdatePersonaBody } from '@hellogram/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { numbersApi } from '../api/numbers.api.js';

export const numberKeys = {
  all: ['personas'] as const,
  one: (id: string) => ['personas', id] as const,
  share: (id: string) => ['personas', id, 'share'] as const,
};

export const useNumbers = () => useQuery({ queryKey: numberKeys.all, queryFn: numbersApi.list });

export function useNumber(id: string) {
  const client = useQueryClient();
  return useQuery({
    queryKey: numberKeys.one(id),
    queryFn: () => numbersApi.get(id),
    // Show the list's copy instantly while the detail request is in flight.
    placeholderData: () => client.getQueryData<PersonaListDto>(numberKeys.all)?.items.find((p) => p.id === id),
  });
}

export const useShare = (id: string) => useQuery({ queryKey: numberKeys.share(id), queryFn: () => numbersApi.share(id) });

/** Writes a fresh persona into both the list and detail caches. */
function useStorePersona() {
  const client = useQueryClient();
  return (persona: OwnPersonaDto) => {
    client.setQueryData(numberKeys.one(persona.id), persona);
    client.setQueryData<PersonaListDto>(numberKeys.all, (list) =>
      list ? { ...list, items: list.items.map((p) => (p.id === persona.id ? persona : p)) } : list,
    );
  };
}

export function useUpdateNumber(id: string) {
  const store = useStorePersona();
  return useMutation({ mutationFn: (body: UpdatePersonaBody) => numbersApi.update(id, body), onSuccess: store });
}

export function usePauseResume(id: string) {
  const store = useStorePersona();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (action: 'pause' | 'resume') => (action === 'pause' ? numbersApi.pause(id) : numbersApi.resume(id)),
    onSuccess: (persona) => {
      store(persona);
      void client.invalidateQueries({ queryKey: numberKeys.all });
    },
  });
}

export function useRetireNumber() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: numbersApi.retire,
    onSuccess: () => client.invalidateQueries({ queryKey: numberKeys.all }),
  });
}

export function useAvatar(id: string) {
  const store = useStorePersona();
  return useMutation({
    mutationFn: (file: File | null) => (file ? numbersApi.uploadAvatar(id, file) : numbersApi.removeAvatar(id)),
    onSuccess: store,
  });
}

export function useCreateNumber() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: numbersApi.create,
    onSuccess: (result) => {
      if (result.kind === 'created') void client.invalidateQueries({ queryKey: numberKeys.all });
    },
  });
}

export const labelOf = (p: Pick<OwnPersonaDto, 'labelKind' | 'labelText'>) =>
  p.labelKind === 'other' ? (p.labelText ?? 'Other') : undefined;
