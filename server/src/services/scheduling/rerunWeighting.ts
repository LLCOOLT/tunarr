import type { RerunWeighting } from '@tunarr/types/api';
import type { Random } from 'random-js';

// How strongly a full-strength setting tilts a pass. A weight of e^3 (about
// 20x) for the most favored program keeps every program in play while moving
// the favored ones well toward the front.
const MaxLogWeight = 3;

/**
 * What a weighted shuffle pass leans on. See
 * plans/premieres-and-rerun-weighting.md.
 */
export type PassWeighting = {
  mode: 'least_recent' | 'unwatched';
  strength: number;
  // Programs the media source reports as watched. Only read in `unwatched`
  // mode.
  watchedIds: ReadonlySet<string>;
};

/**
 * The weighting a schedule asks for, or undefined when it asks for none.
 */
export function passWeightingFor(
  config: RerunWeighting | undefined,
  watchedIds: ReadonlySet<string> = new Set(),
): PassWeighting | undefined {
  if (!config) {
    return;
  }
  switch (config.mode) {
    case 'off':
      return;
    case 'least_recent':
    case 'unwatched':
      return {
        mode: config.mode,
        strength: config.strength,
        watchedIds,
      };
  }
}

/**
 * Recency of each program in the order a pass aired them: 1 for the first
 * program (aired longest ago), falling to 0 for the last. Programs missing
 * from the order have not aired in the previous pass and read as 1.
 */
export function recencyFromAirOrder(
  order: readonly string[],
): ReadonlyMap<string, number> {
  const recency = new Map<string, number>();
  const last = order.length - 1;
  order.forEach((id, index) => {
    recency.set(id, last <= 0 ? 0 : 1 - index / last);
  });
  return recency;
}

/**
 * A program's weight in a weighted pass. Always positive.
 */
export function programWeight(
  programId: string,
  recency: ReadonlyMap<string, number>,
  weighting: PassWeighting,
): number {
  const tilt = MaxLogWeight * weighting.strength;
  let logWeight = tilt * (recency.get(programId) ?? 1);
  if (weighting.mode === 'unwatched' && !weighting.watchedIds.has(programId)) {
    logWeight += tilt;
  }
  return Math.exp(logWeight);
}

/**
 * A random permutation in which each program's chance of coming early is
 * proportional to its weight (Efraimidis-Spirakis: sort by log(u) / w).
 *
 * Draws exactly one number per program, in input order, so the result depends
 * only on the RNG position, the input order and the weights.
 */
export function weightedPassOrder<T extends { uuid: string }>(
  programs: readonly T[],
  random: Random,
  weight: (program: T) => number,
): T[] {
  const keyed = programs.map((program, index) => {
    // random.real(0, 1) is [0, 1); flip it to (0, 1] so the log is finite.
    const u = 1 - random.real(0, 1, false);
    return { program, index, key: Math.log(u) / weight(program) };
  });
  keyed.sort((a, b) => b.key - a.key || a.index - b.index);
  return keyed.map(({ program }) => program);
}
