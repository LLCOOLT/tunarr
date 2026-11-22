import { tag } from '@tunarr/types';
import { describe, expect, test } from 'vitest';
import type { MediaSourceId } from '../../db/schema/base.ts';
import type { MediaSourceApiFactory } from '../../external/MediaSourceApiFactory.ts';
import type {
  WatchStateProgram,
  WatchStateReader,
} from './ProgramWatchStateService.ts';
import {
  ProgramWatchStateService,
  WatchStateBatchSize,
  WatchStateTtlMs,
} from './ProgramWatchStateService.ts';

const sourceA = tag<MediaSourceId>('source-a');
const sourceB = tag<MediaSourceId>('source-b');

function program(
  uuid: string,
  externalKey: string,
  overrides: Partial<WatchStateProgram> = {},
): WatchStateProgram {
  return {
    uuid,
    externalKey,
    sourceType: 'plex',
    mediaSourceId: sourceA,
    ...overrides,
  };
}

function serviceWith(viewed: Record<string, number>) {
  const calls: { mediaSourceId: MediaSourceId; keys: string[] }[] = [];
  const reader: WatchStateReader = (mediaSourceId, keys) => {
    calls.push({ mediaSourceId, keys: [...keys] });
    return Promise.resolve(
      keys.map((ratingKey) => ({
        ratingKey,
        viewCount: viewed[`${mediaSourceId}|${ratingKey}`],
      })),
    );
  };
  // The reader replaces every media-source call, so the factory is never used.
  const service = new ProgramWatchStateService({} as MediaSourceApiFactory);
  service.setReaderForTesting(reader);
  return { service, calls };
}

describe('ProgramWatchStateService', () => {
  test('reports the programs with a view count as watched', async () => {
    const { service } = serviceWith({ 'source-a|10': 1, 'source-b|10': 0 });

    const watched = await service.watchedProgramIds([
      program('p1', '10'),
      program('p2', '11'),
      program('p3', '10', { mediaSourceId: sourceB }),
    ]);

    expect([...watched]).toEqual(['p1']);
  });

  test('reads only Plex programs, in batches per media source', async () => {
    const { service, calls } = serviceWith({});
    const many = Array.from({ length: WatchStateBatchSize + 1 }, (_, i) =>
      program(`p${i}`, `${i}`),
    );

    await service.watchedProgramIds([
      ...many,
      program('jf', 'x', { sourceType: 'jellyfin' }),
      program('local', '', { sourceType: 'local', mediaSourceId: null }),
      program('b', '1', { mediaSourceId: sourceB }),
    ]);

    expect(calls.map((call) => [call.mediaSourceId, call.keys.length])).toEqual(
      [
        [sourceA, WatchStateBatchSize],
        [sourceA, 1],
        [sourceB, 1],
      ],
    );
  });

  test('reuses a fetched state until it goes stale', async () => {
    const { service, calls } = serviceWith({ 'source-a|10': 1 });
    const programs = [program('p1', '10')];

    await service.watchedProgramIds(programs, 0);
    await service.watchedProgramIds(programs, WatchStateTtlMs);
    expect(calls).toHaveLength(1);

    await service.watchedProgramIds(programs, WatchStateTtlMs + 1);
    expect(calls).toHaveLength(2);
  });

  test('a failed read counts as nothing watched', async () => {
    const service = new ProgramWatchStateService({} as MediaSourceApiFactory);
    service.setReaderForTesting(() => Promise.resolve(undefined));

    const watched = await service.watchedProgramIds([program('p1', '10')]);
    expect(watched.size).toBe(0);
  });
});
