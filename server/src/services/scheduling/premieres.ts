import type { CondensedChannelProgram } from '@tunarr/types';
import type { PremiereConfig } from '@tunarr/types/api';
import { isNil, sortBy } from 'lodash-es';
import { z } from 'zod/v4';
import type { Nullable } from '../../types/util.ts';
import dayjs from '../../util/dayjs.ts';
import type { IterationState, ProgramIterator } from './ProgramIterator.ts';
import type { PremiereState } from './slotIteratorState.ts';
import type { SlotSchedulerProgram } from './slotSchedulerUtil.ts';

const OneDayMs = 24 * 60 * 60 * 1000;

/**
 * How long after its premiere moment a new program may still premiere. A
 * program none of the channel's slots reached by then just joins rotation.
 */
export const PremiereWindowMs = 7 * OneDayMs;

// One premiere the scheduler placed: the program, and the time cursor it was
// offered at. The lineup item may start later, behind head filler.
export const PlacedPremiereSchema = z.object({
  programId: z.string(),
  atMs: z.number(),
});

export type PlacedPremiere = z.infer<typeof PlacedPremiereSchema>;

/**
 * When a program first seen at `createdAtMs` premieres: `timeOfDayMs` on the
 * next local day. Hours and minutes are set rather than milliseconds added, so
 * a DST change that night does not move the premiere by an hour.
 */
export function premiereMoment(createdAtMs: number, timeOfDayMs: number) {
  const hours = Math.floor(timeOfDayMs / 3_600_000);
  const minutes = Math.floor((timeOfDayMs % 3_600_000) / 60_000);
  return +dayjs(createdAtMs)
    .startOf('day')
    .add(1, 'day')
    .hour(hours)
    .minute(minutes);
}

const localDay = (ms: number) => dayjs(ms).format('YYYY-MM-DD');

type Candidate = {
  program: SlotSchedulerProgram;
  moment: number;
};

/**
 * Decides which new programs premiere, and records the ones that did. One
 * tracker is shared by every slot iterator of a build, so a program
 * premieres once even when several slots draw from its show.
 */
export class PremiereTracker {
  readonly #config: PremiereConfig;
  readonly #sinceMs: number;
  readonly #premiered: Set<string>;
  readonly #perDay: Record<string, { day: string; count: number }>;
  readonly #placed: PlacedPremiere[] = [];
  readonly #candidatesByKey = new Map<string, Candidate[]>();

  constructor(
    config: PremiereConfig,
    state: PremiereState | undefined,
    cycleStartMs: number,
    programs: readonly SlotSchedulerProgram[],
  ) {
    this.#config = config;
    this.#sinceMs = state?.sinceMs ?? cycleStartMs;
    this.#perDay = { ...state?.perDay };

    // Keep only premiered programs still inside their window. Anything older
    // can never be offered again, so remembering it would only grow the
    // snapshot.
    const byId = new Map(programs.map((program) => [program.uuid, program]));
    this.#premiered = new Set(
      (state?.premieredIds ?? []).filter((id) => {
        const candidate = this.asCandidate(byId.get(id));
        return candidate && candidate.moment + PremiereWindowMs >= cycleStartMs;
      }),
    );
  }

  get placed(): readonly PlacedPremiere[] {
    return this.#placed;
  }

  /**
   * The program `key`'s iterator should air at `timeCursor` instead of its
   * next pick, if any: the earliest new program of the pool whose premiere
   * moment has come, while the key is under its daily cap.
   */
  candidateFor(
    key: string,
    pool: readonly SlotSchedulerProgram[],
    timeCursor: number,
  ): SlotSchedulerProgram | undefined {
    const day = localDay(timeCursor);
    const used = this.#perDay[key];
    if (used && used.day === day && used.count >= this.#config.maxPerDay) {
      return;
    }

    return this.candidates(key, pool).find(
      ({ program, moment }) =>
        !this.#premiered.has(program.uuid) &&
        moment <= timeCursor &&
        timeCursor <= moment + PremiereWindowMs,
    )?.program;
  }

  markPremiered(key: string, programId: string, timeCursor: number) {
    if (this.#premiered.has(programId)) {
      return;
    }
    this.#premiered.add(programId);
    const day = localDay(timeCursor);
    const used = this.#perDay[key];
    this.#perDay[key] =
      used && used.day === day
        ? { day, count: used.count + 1 }
        : { day, count: 1 };
    this.#placed.push({ programId, atMs: timeCursor });
  }

  snapshot(): PremiereState {
    return {
      sinceMs: this.#sinceMs,
      premieredIds: [...this.#premiered],
      perDay: { ...this.#perDay },
    };
  }

  private candidates(key: string, pool: readonly SlotSchedulerProgram[]) {
    const cached = this.#candidatesByKey.get(key);
    if (cached) {
      return cached;
    }
    const found = sortBy(
      pool.flatMap((program) => {
        const candidate = this.asCandidate(program);
        return candidate ? [candidate] : [];
      }),
      ({ moment }) => moment,
      ({ program }) => program.season?.index ?? program.seasonNumber ?? 0,
      ({ program }) => program.episode ?? 0,
      ({ program }) => program.uuid,
    );
    this.#candidatesByKey.set(key, found);
    return found;
  }

  private asCandidate(
    program: SlotSchedulerProgram | undefined,
  ): Candidate | undefined {
    if (!program || isNil(program.createdAt)) {
      return;
    }
    if (program.createdAt < this.#sinceMs) {
      return;
    }
    return {
      program,
      moment: premiereMoment(program.createdAt, this.#config.timeOfDayMs),
    };
  }
}

/**
 * Wraps a show or smart-collection slot iterator so a due premiere airs
 * before the slot's next pick. The wrapped iterator does not advance when a
 * premiere airs, and it keeps the program in its pool, so the program also
 * comes up again in rotation.
 */
export class PremiereProgramIterator implements ProgramIterator {
  #offered: { programId: string; atMs: number } | undefined;

  constructor(
    private readonly inner: ProgramIterator,
    private readonly key: string,
    private readonly pool: readonly SlotSchedulerProgram[],
    private readonly tracker: PremiereTracker,
  ) {}

  current(state: IterationState): Nullable<CondensedChannelProgram> {
    const premiere = this.tracker.candidateFor(
      this.key,
      this.pool,
      state.timeCursor,
    );
    if (premiere) {
      this.#offered = { programId: premiere.uuid, atMs: state.timeCursor };
      return {
        type: 'content',
        id: premiere.uuid,
        duration: premiere.duration,
      };
    }
    this.#offered = undefined;
    return this.inner.current(state);
  }

  next(): void {
    const offered = this.#offered;
    this.#offered = undefined;
    if (offered) {
      this.tracker.markPremiered(this.key, offered.programId, offered.atMs);
      return;
    }
    this.inner.next();
  }

  reset(): void {
    this.#offered = undefined;
    this.inner.reset();
  }

  fork(): ProgramIterator {
    return this;
  }

  snapshot() {
    return this.inner.snapshot?.();
  }
}
