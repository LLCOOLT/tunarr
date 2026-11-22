import z from 'zod/v4';

const NativePlaybackTimingSchema = z.object({
  itemStartedAtMs: z.number().int(),
  remainingMs: z.number().int(),
});

// Where the program's original file lives, so a client that can reach the
// media server itself can play the file directly instead of Tunarr's stream.
// Present only for programs from a remote media server (not local files).
export const NativePlaybackSourceSchema = z.object({
  type: z.enum(['plex', 'jellyfin', 'emby']),
  mediaSourceId: z.string(),
  mediaSourceName: z.string(),
  // The server's own identifier (Plex machineIdentifier), when Tunarr has
  // stored it.
  serverIdentifier: z.string().optional(),
  // The item's key on that server (Plex ratingKey, Jellyfin/Emby item id).
  externalKey: z.string(),
});

export const NativePlaybackContentItemSchema =
  NativePlaybackTimingSchema.extend({
    type: z.literal('content'),
    seekOffsetMs: z.number().int(),
    programId: z.string().uuid(),
    title: z.string(),
    episodeTitle: z.string().optional(),
    seasonNumber: z.number().int().optional(),
    episodeNumber: z.number().int().optional(),
    summary: z.string().optional(),
    thumb: z.string().optional(),
    streamUrl: z.string(),
    // The program's full length. `seekOffsetMs + remainingMs` can be shorter
    // when the schedule cuts the program.
    durationMs: z.number().int().optional(),
    source: NativePlaybackSourceSchema.optional(),
  });

export const NativePlaybackFlexItemSchema = NativePlaybackTimingSchema.extend({
  type: z.literal('flex'),
});

export const NativePlaybackErrorItemSchema = z.object({
  type: z.literal('error'),
  message: z.string(),
  retryAfterMs: z.number().int(),
});

export const NativePlaybackItemSchema = z.discriminatedUnion('type', [
  NativePlaybackContentItemSchema,
  NativePlaybackFlexItemSchema,
  NativePlaybackErrorItemSchema,
]);

export const NativePlaybackResponseSchema = z.object({
  channelId: z.string().uuid(),
  channelNumber: z.number().int(),
  channelName: z.string(),
  serverTimeMs: z.number().int(),
  current: NativePlaybackItemSchema,
  next: NativePlaybackItemSchema.optional(),
});
