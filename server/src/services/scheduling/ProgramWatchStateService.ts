import { isNonEmptyString } from '@tunarr/shared/util';
import { bindingScopeValues, inject, injectable } from 'inversify';
import { chunk } from 'lodash-es';
import type { MediaSourceId } from '../../db/schema/base.ts';
import { MediaSourceApiFactory } from '../../external/MediaSourceApiFactory.ts';
import type { PlexWatchState } from '../../external/plex/PlexApiClient.ts';
import { InjectLogger } from '../../util/inject.ts';
import type { Logger } from '../../util/logging/LoggerFactory.ts';

// Rating keys per request. Plex accepts a comma-separated list on
// /library/metadata; this keeps the URL well under common length limits.
export const WatchStateBatchSize = 50;

// How long a fetched watch state is reused. Cycle builds run every few
// minutes, and the weighting only needs a rough picture.
export const WatchStateTtlMs = 10 * 60 * 1000;

export type WatchStateProgram = {
  uuid: string;
  sourceType: string;
  mediaSourceId: MediaSourceId | null;
  externalKey: string;
};

// The one call this service makes against a media source. Kept to a read so
// nothing here can change what the account has watched.
export type WatchStateReader = (
  mediaSourceId: MediaSourceId,
  ratingKeys: readonly string[],
) => Promise<PlexWatchState[] | undefined>;

type CachedState = { watched: boolean; fetchedAt: number };

/**
 * Reads which programs the Plex account Tunarr signs in with has watched, for
 * rerun weighting's `unwatched` mode. Jellyfin, Emby and local programs read
 * as unwatched. A failed request is logged and its programs read as
 * unwatched, so a weighting never stops a schedule from building.
 */
@injectable(bindingScopeValues.Singleton)
export class ProgramWatchStateService {
  @InjectLogger() declare private readonly logger: Logger;

  #cache = new Map<string, CachedState>();
  #reader: WatchStateReader;

  constructor(
    @inject(MediaSourceApiFactory)
    mediaSourceApiFactory: MediaSourceApiFactory,
  ) {
    this.#reader = async (mediaSourceId, ratingKeys) => {
      const client =
        await mediaSourceApiFactory.getPlexApiClientById(mediaSourceId);
      if (!client) {
        return;
      }
      const result = await client.getWatchStates(ratingKeys);
      if (result.isFailure()) {
        this.logger.warn(
          result.error,
          'Could not read watch state from media source %s',
          mediaSourceId,
        );
        return;
      }
      return result.get();
    };
  }

  // Tests swap the media source read for a stub.
  setReaderForTesting(reader: WatchStateReader) {
    this.#reader = reader;
    this.#cache.clear();
  }

  async watchedProgramIds(
    programs: readonly WatchStateProgram[],
    now: number = Date.now(),
  ): Promise<Set<string>> {
    const watched = new Set<string>();
    const bySource = new Map<MediaSourceId, WatchStateProgram[]>();
    for (const program of programs) {
      const mediaSourceId = program.mediaSourceId;
      if (
        program.sourceType !== 'plex' ||
        !mediaSourceId ||
        !isNonEmptyString(program.externalKey)
      ) {
        continue;
      }
      const list = bySource.get(mediaSourceId);
      if (list) {
        list.push(program);
      } else {
        bySource.set(mediaSourceId, [program]);
      }
    }

    for (const [mediaSourceId, sourcePrograms] of bySource) {
      const cacheKey = (externalKey: string) =>
        `${mediaSourceId}|${externalKey}`;
      const stale = sourcePrograms.filter((program) => {
        const cached = this.#cache.get(cacheKey(program.externalKey));
        return !cached || now - cached.fetchedAt > WatchStateTtlMs;
      });

      const keys = [...new Set(stale.map((program) => program.externalKey))];
      for (const batch of chunk(keys, WatchStateBatchSize)) {
        const states = await this.#reader(mediaSourceId, batch);
        if (!states) {
          continue;
        }
        const viewed = new Set(
          states
            .filter((state) => (state.viewCount ?? 0) > 0)
            .map((state) => state.ratingKey),
        );
        for (const key of batch) {
          this.#cache.set(cacheKey(key), {
            watched: viewed.has(key),
            fetchedAt: now,
          });
        }
      }

      for (const program of sourcePrograms) {
        if (this.#cache.get(cacheKey(program.externalKey))?.watched) {
          watched.add(program.uuid);
        }
      }
    }

    return watched;
  }
}
