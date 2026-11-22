import { useState } from 'react';

/**
 * The "Rebuild each cycle" choice of a slot editor. A channel that already has
 * a schedule of this type keeps its stored setting; a new slot schedule starts
 * with it on (plans/schedules-reshuffle-on-loop.md, Opt-in).
 */
export function useRebuildEachCycle(
  scheduleType: 'time' | 'random',
  existingType: 'time' | 'random' | undefined,
  stored: boolean | undefined,
) {
  const initial = existingType === scheduleType ? (stored ?? false) : true;
  const [saved, setSaved] = useState(initial);
  const [value, setValue] = useState(initial);
  return {
    value,
    setValue,
    isDirty: value !== saved,
    markSaved: () => setSaved(value),
    reset: () => setValue(saved),
  };
}
