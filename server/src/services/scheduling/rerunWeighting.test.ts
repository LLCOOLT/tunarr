import dayjs from '@/util/dayjs.js';
import type { TimeSlotSchedule } from '@tunarr/types/api';
import { range, sumBy } from 'lodash-es';
import { MersenneTwister19937, Random } from 'random-js';
import { describe, expect, test } from 'vitest';
import {
  fixtureEpisodes,
  fixtureSlotId,
  fixtureTimeSlotSchedule,
} from '../../testing/fakes/slotScheduleFixtures.ts';
import type { PassWeighting } from './rerunWeighting.ts';
import {
  passWeightingFor,
  programWeight,
  recencyFromAirOrder,
  weightedPassOrder,
} from './rerunWeighting.ts';
import type { ProgramIteratorSnapshot } from './slotIteratorState.ts';
import type { SlotSchedulerProgram } from './slotSchedulerUtil.ts';
import { scheduleTimeSlots } from './TimeSlotService.ts';
import { WeightedShuffleProgramIterator } from './WeightedShuffleProgramIterator.ts';

const oneHour = 60 * 60 * 1000;

const randomFor = (seed: number) =>
  new Random(MersenneTwister19937.seedWithArray([seed]));

const leastRecent = (strength = 1): PassWeighting => ({
  mode: 'least_recent',
  strength,
  watchedIds: new Set(),
});

function iterator(
  programs: SlotSchedulerProgram[],
  random: Random,
  weighting: PassWeighting,
  resume?: ProgramIteratorSnapshot,
) {
  return new WeightedShuffleProgramIterator(
    programs,
    random,
    weighting,
    (program) => ({
      type: 'content' as const,
      id: program.uuid,
      duration: program.duration,
    }),
    resume,
  );
}

function take(it: ReturnType<typeof iterator>, count: number): string[] {
  return range(count).map(() => {
    const id = it.current()?.id;
    it.next();
    if (!id) {
      throw new Error('iterator ran dry');
    }
    return id;
  });
}

const mean = (values: number[]) => sumBy(values) / values.length;

describe('passWeightingFor', () => {
  test('off and missing settings mean no weighting', () => {
    expect(passWeightingFor(undefined)).toBeUndefined();
    expect(passWeightingFor({ mode: 'off', strength: 1 })).toBeUndefined();
  });

  test('carries the mode, strength and watched set', () => {
    const watched = new Set(['a']);
    expect(
      passWeightingFor({ mode: 'unwatched', strength: 0.25 }, watched),
    ).toEqual({ mode: 'unwatched', strength: 0.25, watchedIds: watched });
  });
});

describe('recencyFromAirOrder', () => {
  test('first aired is 1, last aired is 0', () => {
    const recency = recencyFromAirOrder(['a', 'b', 'c']);
    expect(recency.get('a')).toBe(1);
    expect(recency.get('b')).toBe(0.5);
    expect(recency.get('c')).toBe(0);
  });

  test('an empty or one-program pass gives no tilt', () => {
    expect(recencyFromAirOrder([]).size).toBe(0);
    expect(recencyFromAirOrder(['a']).get('a')).toBe(0);
  });
});

describe('programWeight', () => {
  test('a program missing from the previous pass weighs as least recent', () => {
    const recency = recencyFromAirOrder(['a', 'b']);
    expect(programWeight('new', recency, leastRecent())).toBe(
      programWeight('a', recency, leastRecent()),
    );
  });

  test('strength 0 weighs everything alike', () => {
    const recency = recencyFromAirOrder(['a', 'b']);
    expect(programWeight('a', recency, leastRecent(0))).toBe(1);
    expect(programWeight('b', recency, leastRecent(0))).toBe(1);
  });

  test('unwatched mode favors unwatched programs; least_recent ignores it', () => {
    const recency = new Map<string, number>();
    const watchedIds = new Set(['seen']);
    const unwatched: PassWeighting = {
      mode: 'unwatched',
      strength: 1,
      watchedIds,
    };
    expect(programWeight('fresh', recency, unwatched)).toBeGreaterThan(
      programWeight('seen', recency, unwatched),
    );
    const recentOnly: PassWeighting = { ...unwatched, mode: 'least_recent' };
    expect(programWeight('fresh', recency, recentOnly)).toBe(
      programWeight('seen', recency, recentOnly),
    );
  });
});

describe('weightedPassOrder', () => {
  const programs = fixtureEpisodes('show', 12, oneHour);

  test('is a permutation and reproducible from the seed', () => {
    const first = weightedPassOrder(programs, randomFor(7), () => 1);
    const second = weightedPassOrder(programs, randomFor(7), () => 1);
    expect(first.map((p) => p.uuid)).toEqual(second.map((p) => p.uuid));
    expect(new Set(first.map((p) => p.uuid))).toEqual(
      new Set(programs.map((p) => p.uuid)),
    );
  });

  test('a heavier program tends to come first', () => {
    const heavy = programs[11]?.uuid;
    const positions = range(400).map((seed) =>
      weightedPassOrder(programs, randomFor(seed), (p) =>
        p.uuid === heavy ? 20 : 1,
      ).findIndex((p) => p.uuid === heavy),
    );
    // Uniform would average 5.5.
    expect(mean(positions)).toBeLessThan(2);
  });
});

describe('WeightedShuffleProgramIterator', () => {
  const programs = () => fixtureEpisodes('show', 10, oneHour);

  test('plays every program once per pass', () => {
    const it = iterator(programs(), randomFor(1), leastRecent());
    const twoPasses = take(it, 20);
    expect(new Set(twoPasses.slice(0, 10)).size).toBe(10);
    expect(new Set(twoPasses.slice(10)).size).toBe(10);
  });

  test('the same seed gives the same sequence', () => {
    const a = take(iterator(programs(), randomFor(3), leastRecent()), 30);
    const b = take(iterator(programs(), randomFor(3), leastRecent()), 30);
    expect(a).toEqual(b);
  });

  test('what aired last in a pass comes up later in the next one', () => {
    const lastToFirstGap = range(300).map((seed) => {
      const sequence = take(
        iterator(programs(), randomFor(seed), leastRecent()),
        20,
      );
      const firstPass = sequence.slice(0, 10);
      const secondPass = sequence.slice(10);
      const lastAired = firstPass[9];
      const firstAired = firstPass[0];
      return (
        secondPass.indexOf(lastAired ?? '') -
        secondPass.indexOf(firstAired ?? '')
      );
    });
    // Without weighting the two are equally likely either way round.
    expect(mean(lastToFirstGap)).toBeGreaterThan(3);
  });

  test('back-to-back repeats across a pass boundary get rarer', () => {
    const repeatRate = (weighting: PassWeighting) =>
      mean(
        range(300).map((seed) => {
          const sequence = take(
            iterator(programs(), randomFor(seed), weighting),
            20,
          );
          // The last program of pass one opening pass two.
          return sequence[9] === sequence[10] ? 1 : 0;
        }),
      );
    expect(repeatRate(leastRecent(1))).toBeLessThan(repeatRate(leastRecent(0)));
  });

  test('unwatched mode moves watched programs back', () => {
    const watchedIds = new Set(
      programs()
        .slice(0, 5)
        .map((p) => p.uuid),
    );
    const weighting: PassWeighting = {
      mode: 'unwatched',
      strength: 1,
      watchedIds,
    };
    const watchedPositions = range(300).flatMap((seed) => {
      const pass = take(iterator(programs(), randomFor(seed), weighting), 10);
      return pass.flatMap((id, index) => (watchedIds.has(id) ? [index] : []));
    });
    // Uniform would average 4.5.
    expect(mean(watchedPositions)).toBeGreaterThan(6);
  });

  test('a resumed pass follows the stored order, whatever the weights say now', () => {
    const it = iterator(programs(), randomFor(5), leastRecent());
    take(it, 4);
    const snapshot = it.snapshot();
    const rest = take(it, 6);

    // A different seed and watch state would order a fresh pass differently.
    const resumed = iterator(
      programs(),
      randomFor(99),
      {
        mode: 'unwatched',
        strength: 1,
        watchedIds: new Set(rest.slice(0, 3)),
      },
      snapshot,
    );
    expect(take(resumed, 6)).toEqual(rest);
  });

  test('a program added since the snapshot joins the end of the pass', () => {
    const it = iterator(programs(), randomFor(5), leastRecent());
    take(it, 4);
    const snapshot = it.snapshot();
    const rest = take(it, 6);

    const withNew = [...programs(), ...fixtureEpisodes('extra', 1, oneHour)];
    const resumed = iterator(withNew, randomFor(5), leastRecent(), snapshot);
    expect(take(resumed, 7)).toEqual([...rest, 'extra-ep1']);
  });

  test('the snapshot keeps the air order of the pass', () => {
    const it = iterator(programs(), randomFor(8), leastRecent());
    const aired = take(it, 3);
    const snapshot = it.snapshot();
    expect(snapshot?.type).toBe('shuffle');
    if (snapshot?.type === 'shuffle') {
      expect(snapshot.playedIds).toEqual(aired);
      expect(snapshot.order).toHaveLength(7);
    }
  });
});

describe('rerun weighting in the time-slot scheduler', () => {
  const schedule = (rerunWeighting?: TimeSlotSchedule['rerunWeighting']) =>
    fixtureTimeSlotSchedule({
      padMs: 1,
      maxDays: 2,
      slots: [
        {
          id: fixtureSlotId(1),
          startTime: 0,
          type: 'show',
          showId: 'show',
          order: 'shuffle',
          direction: 'asc',
          seasonFilter: [],
          seasonExcludeFilter: [],
        },
      ],
      rerunWeighting,
    });

  const build = (s: TimeSlotSchedule) =>
    scheduleTimeSlots(
      s,
      fixtureEpisodes('show', 10, oneHour),
      [42],
      0,
      dayjs.utc('2024-03-04T00:00:00.000Z'),
      {},
    );

  const ids = (lineup: { type: string }[]) =>
    lineup.flatMap((program) =>
      'id' in program && typeof program.id === 'string' ? [program.id] : [],
    );

  test('mode off schedules exactly like no setting', async () => {
    const plain = await build(schedule());
    const off = await build(schedule({ mode: 'off', strength: 1 }));
    expect(ids(off.lineup)).toEqual(ids(plain.lineup));
  });

  test('a weighted slot stores the planned order of its pass', async () => {
    const weighted = await build(
      schedule({ mode: 'least_recent', strength: 1 }),
    );
    const snapshot = weighted.iteratorState.iterators['slot:0'];
    expect(snapshot?.type).toBe('shuffle');
    expect(snapshot?.type === 'shuffle' && snapshot.order).toBeDefined();
    // Still every program once per pass.
    const firstPass = ids(weighted.lineup).slice(0, 10);
    expect(new Set(firstPass).size).toBe(10);
  });
});
