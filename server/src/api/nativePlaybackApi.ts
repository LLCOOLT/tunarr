import type { RouterPluginAsyncCallback } from '@/types/serverType.js';
import { LoggerFactory } from '@/util/logging/LoggerFactory.js';
import type { NativePlaybackItem, NativePlaybackSource } from '@tunarr/types';
import { BasicIdParamSchema } from '@tunarr/types/api';
import { NativePlaybackResponseSchema } from '@tunarr/types/schemas';
import { isNil } from 'lodash-es';
import { isNonEmptyString } from '../util/index.ts';
import z from 'zod/v4';
import type {
  StreamLineupItem,
  StreamLineupProgram,
} from '../db/derived_types/StreamLineup.ts';
import {
  isContentBackedLineupItem,
  isOfflineLineupItem,
} from '../db/derived_types/StreamLineup.ts';

function buildStreamUrl(
  baseUrl: string,
  channelId: string,
  itemStartedAtMs: number,
): string {
  return `${baseUrl}/stream/channels/${channelId}/item-stream.ts?t=${itemStartedAtMs}`;
}

/**
 * Where a program's original file lives, for a client that plays it from the
 * media server directly. `serverIdentifier` is the media source's stored client
 * identifier (Plex machineIdentifier), when known. Local files have no remote
 * key, so they get none.
 */
export function playbackSourceForProgram(
  program: StreamLineupProgram,
  serverIdentifier: string | null | undefined,
): NativePlaybackSource | undefined {
  if (!isNonEmptyString(program.externalKey)) {
    return;
  }
  switch (program.sourceType) {
    case 'plex':
    case 'jellyfin':
    case 'emby':
      return {
        type: program.sourceType,
        mediaSourceId: program.mediaSourceId,
        mediaSourceName: program.externalSourceId,
        serverIdentifier: isNonEmptyString(serverIdentifier)
          ? serverIdentifier
          : undefined,
        externalKey: program.externalKey,
      };
    case 'local':
      return;
  }
}

export function mapLineupItemToPlaybackItem(
  lineupItem: StreamLineupItem,
  baseUrl: string,
  channelId: string,
  serverIdentifier?: string | null,
): NativePlaybackItem {
  const remainingMs = lineupItem.streamDuration;
  const itemStartedAtMs = lineupItem.programBeginMs;

  if (isOfflineLineupItem(lineupItem)) {
    return {
      type: 'flex',
      remainingMs,
      itemStartedAtMs,
    };
  }

  if (isContentBackedLineupItem(lineupItem)) {
    const program = lineupItem.program;
    return {
      type: 'content',
      itemStartedAtMs,
      seekOffsetMs: lineupItem.startOffset ?? 0,
      remainingMs,
      programId: program.uuid,
      // For TV episodes: show title is the primary title, episode title is secondary
      // For movies: program title is the primary title
      title: program.showTitle ?? program.title,
      episodeTitle: program.showTitle ? program.title : undefined,
      seasonNumber: program.seasonNumber ?? undefined,
      episodeNumber: program.episode ?? undefined,
      summary: program.summary ?? undefined,
      thumb: program.icon ?? undefined,
      streamUrl: buildStreamUrl(baseUrl, channelId, itemStartedAtMs),
      durationMs: program.duration,
      source: playbackSourceForProgram(program, serverIdentifier),
      ...(lineupItem.type === 'program' && lineupItem.isPremiere
        ? { isPremiere: true }
        : {}),
    };
  }

  // error or redirect items fall through as flex
  return {
    type: 'flex',
    remainingMs: lineupItem.streamDuration,
    itemStartedAtMs: lineupItem.programBeginMs,
  };
}

// eslint-disable-next-line @typescript-eslint/require-await
export const nativePlaybackApi: RouterPluginAsyncCallback = async (fastify) => {
  const logger = LoggerFactory.child({
    caller: import.meta,
    className: 'NativePlaybackApi',
  });

  fastify.addHook('onError', (req, _, error, done) => {
    logger.error(
      error,
      'Error in NativePlaybackApi: %s %s',
      req.method,
      req.url,
    );
    done();
  });

  fastify.get(
    '/channels/:id/native-playback',
    {
      schema: {
        tags: ['Native'],
        description:
          'Returns current and next playback items for native client players (tvOS, Android TV). Includes timing data for live TV simulation.',
        params: BasicIdParamSchema,
        response: {
          200: NativePlaybackResponseSchema,
          404: z.void(),
        },
      },
    },
    async (req, res) => {
      const channel = await req.serverCtx.channelDB.getChannelOrm(
        req.params.id,
      );

      if (isNil(channel)) {
        return res.status(404).send();
      }

      const now = Date.now();
      const baseUrl = `${req.protocol}://${req.host}`;
      const calculator = req.serverCtx.streamProgramCalculator;

      const currentResult = await calculator.getCurrentLineupItem({
        channelId: channel.uuid,
        startTime: now,
        allowSkip: false,
      });

      if (currentResult.isFailure()) {
        logger.error(
          currentResult.error,
          'Failed to get current lineup item for channel %s',
          channel.uuid,
        );
        return res.status(200).send({
          channelId: channel.uuid,
          channelNumber: channel.number,
          channelName: channel.name,
          serverTimeMs: now,
          current: {
            type: 'error',
            message:
              currentResult.error.message ??
              'Unable to determine current program',
            retryAfterMs: 5000,
          },
        });
      }

      const serverIdentifiers = new Map<string, string | null>();
      const serverIdentifierFor = async (lineupItem: StreamLineupItem) => {
        if (!isContentBackedLineupItem(lineupItem)) {
          return null;
        }
        const id = lineupItem.program.mediaSourceId;
        const known = serverIdentifiers.get(id);
        if (known !== undefined) {
          return known;
        }
        const source = await req.serverCtx.mediaSourceDB.getById(id);
        const found = source?.clientIdentifier ?? null;
        serverIdentifiers.set(id, found);
        return found;
      };

      const currentLineupItem = currentResult.get().lineupItem;
      const current = mapLineupItemToPlaybackItem(
        currentLineupItem,
        baseUrl,
        channel.uuid,
        await serverIdentifierFor(currentLineupItem),
      );

      // Fetch next item. It has not aired yet, so it must not be recorded as
      // played: play history is stamped with the request time, and a
      // future-dated row would count against the filler cooldowns.
      const nextStartTime = now + currentLineupItem.streamDuration + 1;
      const nextResult = await calculator.getCurrentLineupItem({
        channelId: channel.uuid,
        startTime: nextStartTime,
        allowSkip: false,
        recordPlayHistory: false,
      });

      let next: NativePlaybackItem | undefined;
      if (nextResult.isSuccess()) {
        const nextLineupItem = nextResult.get().lineupItem;
        next = mapLineupItemToPlaybackItem(
          nextLineupItem,
          baseUrl,
          channel.uuid,
          await serverIdentifierFor(nextLineupItem),
        );
      }

      return res.status(200).send({
        channelId: channel.uuid,
        channelNumber: channel.number,
        channelName: channel.name,
        serverTimeMs: now,
        current,
        next,
      });
    },
  );
};
