import dayjs from '@/util/dayjs.js';
import type {
  PremiereConfig,
  RandomSlotSchedule,
  TimeSlotSchedule,
} from '@tunarr/types/api';
import { sumBy } from 'lodash-es';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { markPremieres } from '../../commands/BuildSlotCycleCommand.ts';
import type { LineupItem } from '../../db/derived_types/Lineup.ts';
import {
  fixtureEpisodes,
  fixtureRandomSlotSchedule,
  fixtureSlotId,
  fixtureTimeSlotSchedule,
} from '../../testing/fakes/slotScheduleFixtures.ts';
import { premiereMoment, PremiereWindowMs } from './premieres.ts';
import { RandomSlotScheduler } from './RandomSlotsService.ts';
import type { SlotIteratorState } from './slotIteratorState.ts';
import type { SlotSchedulerProgram } from './slotSchedulerUtil.ts';
import { scheduleTimeSlots } from './TimeSlotService.ts';

// Premiere moments are local days. Pin the zone so they line up with the
// UTC timestamps below.
let originalTz: string | undefined;

beforeAll(() => {
  originalTz = process.env.TZ;
  process.env.TZ = 'UTC';
});

afterAll(() => {
  if (originalTz === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = originalTz;
  }
});

const oneHour = 60 * 60 * 1000;
const oneDay = 24 * oneHour;
const day1 = +dayjs.utc('2024-03-04T00:00:00.000Z');
const day2 = day1 + oneDay;
const day3 = day2 + oneDay;
const eightPm = 20 * oneHour;

const premieres = (
  overrides: Partial<PremiereConfig> = {},
): PremiereConfig => ({
  enabled: true,
  timeOfDayMs: eightPm,
  maxPerDay: 1,
  ...overrides,
});

// One shuffle slot covering the whole day, so a day is 24 hour-long programs
// with one starting on every hour.
function daySchedule(
  overrides: Partial<TimeSlotSchedule> = {},
): TimeSlotSchedule {
  return fixtureTimeSlotSchedule({
    padMs: 1,
    maxDays: 365,
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
    premieres: premieres(),
    ...overrides,
  });
}

// 30 old episodes, plus new ones Tunarr first saw at the given times.
function library(newAt: number[]): SlotSchedulerProgram[] {
  const old = fixtureEpisodes('show', 30, oneHour).map((program) => ({
    ...program,
    createdAt: day1 - 30 * oneDay,
  }));
  const fresh = fixtureEpisodes('show', newAt.length, oneHour).map(
    (program, i) => ({
      ...program,
      uuid: `new-${i + 1}`,
      title: `New ${i + 1}`,
      seasonNumber: 9,
      episode: i + 1,
      createdAt: newAt[i] ?? null,
    }),
  );
  return [...old, ...fresh];
}

type Built = {
  items: { id: string; startMs: number }[];
  premieres: { programId: string; atMs: number }[];
  iteratorState: SlotIteratorState;
  discardCount: number;
};

async function buildDay(
  schedule: TimeSlotSchedule,
  programs: SlotSchedulerProgram[],
  start: number,
  from?: Pick<Built, 'iteratorState' | 'discardCount'>,
  opts: { endTime?: boolean } = { endTime: true },
): Promise<Built> {
  const result = await scheduleTimeSlots(
    schedule,
    programs,
    [42],
    from?.discardCount ?? 0,
    dayjs.utc(start),
    {
      iteratorState: from?.iteratorState,
      endTime: opts.endTime ? dayjs.utc(start + oneDay) : undefined,
    },
  );
  let cursor = start;
  const items = result.lineup.map((program) => {
    const startMs = cursor;
    cursor += program.duration;
    return { id: 'id' in program ? (program.id ?? '') : '', startMs };
  });
  return {
    items,
    premieres: result.premieres ?? [],
    iteratorState: result.iteratorState,
    discardCount: result.discardCount,
  };
}

const startOf = (built: Built, id: string) =>
  built.items.filter((item) => item.id === id).map((item) => item.startMs);

describe('premiereMoment', () => {
  test('is the chosen time on the day after Tunarr first saw the program', () => {
    expect(premiereMoment(day1 + 10 * oneHour, eightPm)).toBe(day2 + eightPm);
    expect(premiereMoment(day1 + 23 * oneHour, eightPm)).toBe(day2 + eightPm);
  });
});

describe('premieres in time slots', () => {
  test('a new episode premieres at the chosen time the next day, once', async () => {
    const programs = library([day1 + 10 * oneHour]);
    const schedule = daySchedule();

    const first = await buildDay(schedule, programs, day1);
    expect(first.premieres).toEqual([]);

    const second = await buildDay(schedule, programs, day2, first);
    expect(second.premieres).toEqual([
      { programId: 'new-1', atMs: day2 + eightPm },
    ]);
    expect(startOf(second, 'new-1')).toContain(day2 + eightPm);
    expect(second.iteratorState.premieres?.premieredIds).toEqual(['new-1']);

    const third = await buildDay(schedule, programs, day3, second);
    expect(third.premieres).toEqual([]);
  });

  test('programs Tunarr saw before premieres were turned on never premiere', async () => {
    const programs = library([day1 - oneDay]);
    const schedule = daySchedule();

    const first = await buildDay(schedule, programs, day1);
    const second = await buildDay(schedule, programs, day2, first);
    expect(first.iteratorState.premieres?.sinceMs).toBe(day1);
    expect(second.premieres).toEqual([]);
  });

  test('the daily cap spreads a season drop over several days', async () => {
    const programs = library([
      day1 + oneHour,
      day1 + 2 * oneHour,
      day1 + 3 * oneHour,
    ]);
    const schedule = daySchedule();

    const first = await buildDay(schedule, programs, day1);
    const second = await buildDay(schedule, programs, day2, first);
    const third = await buildDay(schedule, programs, day3, second);

    expect(second.premieres).toEqual([
      { programId: 'new-1', atMs: day2 + eightPm },
    ]);
    // new-2 was due on day 2 too; the cap moves it to the first slot of day 3.
    expect(third.premieres.map((p) => p.programId)).toEqual(['new-2']);
  });

  test('a higher cap airs them back to back from the premiere time', async () => {
    const programs = library([day1 + oneHour, day1 + 2 * oneHour]);
    const schedule = daySchedule({ premieres: premieres({ maxPerDay: 2 }) });

    const first = await buildDay(schedule, programs, day1);
    const second = await buildDay(schedule, programs, day2, first);
    expect(second.premieres).toEqual([
      { programId: 'new-1', atMs: day2 + eightPm },
      { programId: 'new-2', atMs: day2 + 21 * oneHour },
    ]);
  });

  test('a program past its window just joins rotation', async () => {
    const programs = library([day1 + oneHour]);
    const schedule = daySchedule();
    const late = day2 + PremiereWindowMs + oneDay;

    const first = await buildDay(schedule, programs, day1);
    const afterWindow = await buildDay(schedule, programs, late, {
      ...first,
      iteratorState: first.iteratorState,
    });
    expect(afterWindow.premieres).toEqual([]);
  });

  test('rebuilding a cycle from its start snapshot places the same premiere', async () => {
    const programs = library([day1 + 10 * oneHour]);
    const schedule = daySchedule();

    const first = await buildDay(schedule, programs, day1);
    const second = await buildDay(schedule, programs, day2, first);
    const again = await buildDay(schedule, programs, day2, first);
    expect(again.items).toEqual(second.items);
    expect(again.premieres).toEqual(second.premieres);
  });

  test('a looping lineup (no cycle end) never premieres', async () => {
    const programs = library([day1 - oneHour]);
    const schedule = daySchedule();
    const built = await buildDay(schedule, programs, day1, undefined, {
      endTime: false,
    });
    expect(built.premieres).toEqual([]);
    expect(built.iteratorState.premieres).toBeUndefined();
  });

  test('premieres off leaves the schedule exactly as before', async () => {
    const programs = library([day1 + oneHour]);
    const on = daySchedule();
    const off = daySchedule({ premieres: undefined });

    const firstOn = await buildDay(on, programs, day1);
    const firstOff = await buildDay(off, programs, day1);
    // No premiere is due on day 1, so the two agree.
    expect(firstOn.items).toEqual(firstOff.items);
  });
});

describe('premieres in random slots', () => {
  test('a new episode premieres in the first slot at or after the time', () => {
    const programs = library([day1 + oneHour]);
    const base = fixtureRandomSlotSchedule();
    const schedule: RandomSlotSchedule = {
      ...base,
      maxDays: 1,
      padMs: 1,
      slots: [
        {
          id: fixtureSlotId(101),
          weight: 1,
          cooldownMs: 0,
          type: 'show',
          showId: 'show',
          order: 'shuffle',
          direction: 'asc',
          seasonFilter: [],
          seasonExcludeFilter: [],
          durationSpec: { type: 'fixed', durationMs: oneHour },
        },
      ],
      premieres: premieres(),
    };

    const build = (start: number, iteratorState?: SlotIteratorState) =>
      new RandomSlotScheduler(schedule).generateSchedule(
        programs,
        [42],
        0,
        dayjs.utc(start),
        { iteratorState, endTime: dayjs.utc(start + oneDay) },
      );

    const first = build(day1);
    expect(first.premieres).toEqual([]);
    const second = build(day2, first.iteratorState);
    expect(second.premieres?.map((p) => p.programId)).toEqual(['new-1']);
    const at = second.premieres?.[0]?.atMs ?? 0;
    expect(at).toBeGreaterThanOrEqual(day2 + eightPm);
    expect(at).toBeLessThan(day2 + eightPm + 2 * oneHour);
  });
});

describe('markPremieres', () => {
  const content = (id: string, durationMs = oneHour): LineupItem => ({
    type: 'content',
    id,
    durationMs,
  });

  test('flags the first matching item at or after the offer time', () => {
    const items: LineupItem[] = [
      content('a'),
      content('p'),
      { type: 'offline', durationMs: oneHour },
      content('p'),
    ];
    const marked = markPremieres(items, day1, [
      { programId: 'p', atMs: day1 + oneHour },
    ]);
    expect(marked.map((item) => 'premiere' in item && item.premiere)).toEqual([
      false,
      true,
      false,
      false,
    ]);
    expect(sumBy(marked, (item) => item.durationMs)).toBe(4 * oneHour);
  });

  test('skips an earlier airing of the same program', () => {
    const items = [content('p'), content('x'), content('p')];
    const marked = markPremieres(items, day1, [
      { programId: 'p', atMs: day1 + 30 * 60 * 1000 },
    ]);
    expect(marked.map((item) => 'premiere' in item && item.premiere)).toEqual([
      false,
      false,
      true,
    ]);
  });

  test('no premieres returns the items untouched', () => {
    const items = [content('a')];
    expect(markPremieres(items, day1, [])).toBe(items);
  });
});
