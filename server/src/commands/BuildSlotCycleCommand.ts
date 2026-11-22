import { isNonEmptyString, seq } from '@tunarr/shared/util';
import type { CondensedChannelProgram } from '@tunarr/types';
import { inject, injectable } from 'inversify';
import { sumBy } from 'lodash-es';
import { condensedProgramToLineupItem } from '../db/channel/lineupItemConversion.ts';
import type { LineupConfig, LineupItem } from '../db/derived_types/Lineup.ts';
import { isContentItem } from '../db/derived_types/Lineup.ts';
import type { PlacedPremiere } from '../services/scheduling/premieres.ts';
import type { IWorkerPool } from '../interfaces/IWorkerPool.ts';
import type {
  BuiltCycle,
  CycleSnapshot,
} from '../services/scheduling/slotCycles.ts';
import { cycleEndTime } from '../services/scheduling/slotCycles.ts';
import { KEYS } from '../types/inject.ts';
import type { Nullable } from '../types/util.ts';

type Request = {
  channelId: string;
  lineup: LineupConfig;
  startTime: number;
  snapshot: CycleSnapshot | undefined;
};

/**
 * Builds one cycle of a slot schedule and hands back its items and end state.
 *
 * It writes nothing. SlotCycleBoundaryService decides what to keep and
 * persists it in one go, under the channel's lineup lock.
 */
@injectable()
export class BuildSlotCycleCommand {
  constructor(
    @inject(KEYS.WorkerPoolFactory)
    private workerPoolProvider: () => IWorkerPool,
  ) {}

  async execute({
    channelId,
    lineup,
    startTime,
    snapshot,
  }: Request): Promise<BuiltCycle> {
    const { schedule, scheduleSeed } = lineup;
    if (!schedule) {
      throw new Error(
        `Channel ${channelId} has no slot schedule to build a cycle from`,
      );
    }

    // Every cycle replays the same seeded RNG from its stored discard count.
    // Without a seed the scheduler mints fresh entropy per cycle, which makes
    // the count meaningless and a cascade unable to reproduce what aired.
    if (!scheduleSeed) {
      throw new Error(
        `Channel ${channelId} rebuilds each cycle but has no schedule seed`,
      );
    }

    const request = {
      type: 'channel' as const,
      channelId,
      startTime,
      seed: scheduleSeed,
      discardCount: snapshot?.discardCount ?? 0,
      iteratorState: snapshot?.iteratorState,
      endTime: cycleEndTime(schedule, startTime),
    };

    const { result } =
      schedule.type === 'time'
        ? await this.workerPoolProvider().queueTask({
            type: 'time-slots',
            request: { ...request, schedule },
          })
        : await this.workerPoolProvider().queueTask({
            type: 'schedule-slots',
            request: { ...request, schedule },
          });

    const items = markPremieres(
      seq.collect(result.lineup, channelProgramToLineupItem),
      startTime,
      result.premieres ?? [],
    );

    return {
      items,
      durationMs: sumBy(items, (item) => item.durationMs),
      endSnapshot: {
        discardCount: result.discardCount,
        iteratorState: result.iteratorState,
      },
    };
  }
}

/**
 * Flags each premiere the scheduler placed on its lineup item: the first item
 * of that program starting at or after the time the premiere was offered at.
 * Head filler can push the program itself a little later.
 */
export function markPremieres(
  items: LineupItem[],
  cycleStartMs: number,
  premieres: readonly PlacedPremiere[],
): LineupItem[] {
  if (premieres.length === 0) {
    return items;
  }

  const pending = [...premieres];
  let start = cycleStartMs;
  return items.map((item) => {
    const itemStart = start;
    start += item.durationMs;
    if (!isContentItem(item)) {
      return item;
    }
    const index = pending.findIndex(
      (premiere) =>
        premiere.programId === item.id && premiere.atMs <= itemStart,
    );
    if (index < 0) {
      return item;
    }
    pending.splice(index, 1);
    return { ...item, premiere: true };
  });
}

function channelProgramToLineupItem(
  p: CondensedChannelProgram,
): Nullable<LineupItem> {
  if (p.type === 'content' && !isNonEmptyString(p.id)) {
    return null;
  }
  return condensedProgramToLineupItem(p);
}
