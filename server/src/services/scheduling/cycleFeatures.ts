import type { RandomSlotSchedule, TimeSlotSchedule } from '@tunarr/types/api';
import { PremiereTracker } from './premieres.ts';
import { passWeightingFor } from './rerunWeighting.ts';
import type { SlotCycleOptions } from './slotIteratorState.ts';
import type {
  SlotIteratorOptions,
  SlotSchedulerProgram,
} from './slotSchedulerUtil.ts';

/**
 * The iterator options a schedule's premieres and rerun weighting settings
 * ask for. Premieres only apply to cycle builds (an `endTime` is set): a
 * looping lineup has no later cycle to place one in.
 */
export function cycleFeatureOptions(
  schedule: TimeSlotSchedule | RandomSlotSchedule,
  cycle: SlotCycleOptions,
  cycleStartMs: number,
  programs: readonly SlotSchedulerProgram[],
): SlotIteratorOptions {
  const premieres =
    schedule.premieres?.enabled && cycle.endTime !== undefined
      ? new PremiereTracker(
          schedule.premieres,
          cycle.iteratorState?.premieres,
          cycleStartMs,
          programs,
        )
      : undefined;

  return {
    weighting: passWeightingFor(
      schedule.rerunWeighting,
      cycle.watchedProgramIds,
    ),
    premieres,
  };
}
