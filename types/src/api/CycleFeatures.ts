import { z } from 'zod';

// Opt-in slot-schedule settings that act when a cycle is built. See
// plans/premieres-and-rerun-weighting.md.

export const DefaultPremiereTimeOfDayMs = 20 * 60 * 60 * 1000;

// A new episode of a show a slot draws from airs once at `timeOfDayMs` (local
// time) on the day after Tunarr first sees it, before joining rotation. Only
// applied to channels that rebuild each cycle.
export const PremiereConfigSchema = z.object({
  enabled: z.boolean(),
  timeOfDayMs: z
    .number()
    .int()
    .min(0)
    .max(24 * 60 * 60 * 1000 - 1)
    .default(DefaultPremiereTimeOfDayMs),
  // Premieres per slot iterator per local day.
  maxPerDay: z.number().int().positive().default(1),
});

export type PremiereConfig = z.infer<typeof PremiereConfigSchema>;

export const RerunWeightingModeSchema = z.enum([
  'off',
  'least_recent',
  'unwatched',
]);

export type RerunWeightingMode = z.infer<typeof RerunWeightingModeSchema>;

// Biases the order inside each shuffle pass: programs that aired longest ago
// on the channel (and, in `unwatched` mode, programs the Plex account has not
// watched) come up earlier. Every program still airs once per pass.
export const RerunWeightingSchema = z.object({
  mode: RerunWeightingModeSchema,
  strength: z.number().min(0).max(1).default(0.5),
});

export type RerunWeighting = z.infer<typeof RerunWeightingSchema>;
