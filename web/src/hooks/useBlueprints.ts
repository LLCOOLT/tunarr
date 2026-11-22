import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  Blueprint,
  BlueprintPreviewResponse,
  BlueprintScope,
  SavedBlueprint,
} from '@tunarr/types/api';
import {
  BlueprintPreviewResponseSchema,
  BlueprintSchema,
  SavedBlueprintSchema,
} from '@tunarr/types/api';
import { isEqual } from 'lodash-es';
import { useDebounceValue } from 'usehooks-ts';
import {
  createChannelFromBlueprint,
  deleteBlueprint,
  getBlueprints,
  getChannelBlueprint,
  importBlueprint,
  previewBlueprint,
} from '../generated/sdk.gen.ts';
import { invalidateTaggedQueries } from '../helpers/queryUtil.ts';

const BlueprintsKey = ['blueprints'];

/** The built-in and saved blueprints. */
export function useBlueprints() {
  return useQuery({
    queryKey: BlueprintsKey,
    queryFn: async ({ signal }) => {
      const { data } = await getBlueprints({ signal, throwOnError: true });
      // OpenAPI widens some enums; read the shape back through the schema.
      return SavedBlueprintSchema.array().parse(data);
    },
  });
}

/** What each role of `blueprint` matches in `scope`. */
export function useBlueprintPreview(
  blueprint: Blueprint | undefined,
  scope: BlueprintScope,
) {
  const [settled] = useDebounceValue({ blueprint, scope }, 400, {
    equalityFn: isEqual,
  });
  return useQuery({
    queryKey: ['blueprints', 'preview', settled],
    queryFn: async (): Promise<BlueprintPreviewResponse> => {
      if (!settled.blueprint) {
        throw new Error('No blueprint to preview');
      }
      const { data } = await previewBlueprint({
        body: { blueprint: settled.blueprint, scope: settled.scope },
        throwOnError: true,
      });
      return BlueprintPreviewResponseSchema.parse(data);
    },
    enabled: settled.blueprint !== undefined,
    placeholderData: keepPreviousData,
  });
}

export function useCreateChannelFromBlueprint() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (request: {
      blueprint: Blueprint;
      scope?: BlueprintScope;
      channelName?: string;
      channelNumber?: number;
    }) => {
      const { data } = await createChannelFromBlueprint({
        body: request,
        throwOnError: true,
      });
      return data;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        predicate: invalidateTaggedQueries('Channels'),
      }),
  });
}

export function useImportBlueprint() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (blueprint: Blueprint): Promise<SavedBlueprint> => {
      const { data } = await importBlueprint({
        body: blueprint,
        throwOnError: true,
      });
      return SavedBlueprintSchema.parse(data);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: BlueprintsKey }),
  });
}

export function useDeleteBlueprint() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await deleteBlueprint({ path: { id }, throwOnError: true });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: BlueprintsKey }),
  });
}

/** A slot channel read back as a blueprint (422 when it cannot be one). */
export async function fetchChannelBlueprint(
  channelId: string,
): Promise<Blueprint> {
  const { data } = await getChannelBlueprint({
    path: { id: channelId },
    throwOnError: true,
  });
  return BlueprintSchema.parse(data);
}
