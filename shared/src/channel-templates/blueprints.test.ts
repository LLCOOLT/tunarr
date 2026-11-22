import type {
  Blueprint,
  RandomSlotSchedule,
  TimeSlotSchedule,
} from '@tunarr/types/api';
import {
  BlueprintSchema,
  StrictRandomSlotScheduleSchema,
  StrictTimeSlotScheduleSchema,
} from '@tunarr/types/api';
import { readFileSync } from 'node:fs';
import { v4 } from 'uuid';
import { describe, expect, test } from 'vitest';
import {
  SearchParser,
  parsedSearchToRequest,
  tokenizeSearchQuery,
} from '../util/searchUtil.js';
import {
  BuiltInBlueprints,
  NinetiesSitcomsBlueprint,
  blueprintAssignments,
  blueprintChannelName,
  blueprintFromSchedule,
  blueprintRoleProblems,
  blueprintToPreset,
  compileBlueprintRules,
  parseBlueprintJson,
} from './blueprints.js';

function parseFilter(filterString: string) {
  const tokenized = tokenizeSearchQuery(filterString);
  expect(tokenized.errors).toEqual([]);
  const parser = new SearchParser();
  parser.input = tokenized.tokens;
  const clause = parser.searchExpression();
  expect(parser.errors).toEqual([]);
  return parsedSearchToRequest(clause);
}

// What AutoChannelService does on create: role slots become smart collection
// slots pointing at one collection per role.
function resolve(
  blueprint: Blueprint,
  collectionIdByRole: Record<string, string>,
): TimeSlotSchedule | RandomSlotSchedule {
  const schedule = blueprint.schedule;
  const toCollection = <S extends { role: string }>(slots: S[]) =>
    slots.map(({ role, ...slot }) => ({
      ...slot,
      id: v4(),
      type: 'smart-collection' as const,
      smartCollectionId: collectionIdByRole[role] ?? 'missing',
    }));
  return schedule.type === 'time'
    ? { ...schedule, slots: toCollection(schedule.slots) }
    : { ...schedule, slots: toCollection(schedule.slots) };
}

function collectionIds(blueprint: Blueprint) {
  return Object.fromEntries(blueprint.roles.map((r) => [r.role, v4()]));
}

describe('blueprints module', () => {
  // The web app imports this module, so it cannot depend on Node built-ins.
  test('imports no Node built-ins', () => {
    const source = readFileSync(
      new URL('./blueprints.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/from ['"]node:/);
  });
});

describe('BuiltInBlueprints', () => {
  test('ship the six built-ins with unique ids', () => {
    const ids = BuiltInBlueprints.map((b) => b.id);
    expect(ids).toEqual([
      'saturday-morning-cartoons',
      '90s-sitcoms',
      'movie-night-at-8',
      'hourly-rotation',
      'kids-all-day',
      'comfort-tv',
    ]);
  });

  describe.each(BuiltInBlueprints.map((b) => [b.id, b] as const))(
    '%s',
    (_id, blueprint) => {
      test('round-trips through JSON and the schema unchanged', () => {
        const json = JSON.parse(JSON.stringify(blueprint)) as unknown;
        const parsed = BlueprintSchema.parse(json);
        expect(parsed).toEqual(blueprint);
        expect(parseBlueprintJson(json)).toEqual({
          success: true,
          blueprint,
        });
      });

      test('names every role it defines, and only those', () => {
        expect(blueprintRoleProblems(blueprint)).toEqual([]);
      });

      test('compiles each role to a filter the search DSL parses', () => {
        for (const role of blueprint.roles) {
          if (role.rules) {
            expect(role.query).toEqual(compileBlueprintRules(role.rules));
          }
          if (role.query.filterString) {
            parseFilter(role.query.filterString);
          }
        }
      });

      test('resolves to a schedule the channels API accepts', () => {
        const resolved = resolve(blueprint, collectionIds(blueprint));
        const strict =
          resolved.type === 'time'
            ? StrictTimeSlotScheduleSchema.safeParse(resolved)
            : StrictRandomSlotScheduleSchema.safeParse(resolved);
        expect(strict.error?.issues ?? []).toEqual([]);
      });

      test('compiles to a preset whose roles match its schedule', () => {
        const preset = blueprintToPreset(blueprint);
        expect(preset.scheduleType).toBe(blueprint.schedule.type);
        expect(preset.contentRequirements.map((r) => r.role)).toEqual(
          blueprint.roles.map((r) => r.role),
        );
        expect(preset.dynamicRequirements).toBeUndefined();
      });
    },
  );
});

describe('compileBlueprintRules', () => {
  test('reads the show-level fields for genre, rating and studio', () => {
    expect(
      compileBlueprintRules({
        programTypes: ['episode'],
        genres: ['Comedy', 'Family'],
        contentRatings: ['TV-Y'],
        studios: ['NBC'],
        yearFrom: 1990,
        yearTo: 1999,
        minMinutes: 20,
        maxMinutes: 35,
      }),
    ).toEqual({
      programTypes: ['episode'],
      filterString:
        '(genre in ["Comedy", "Family"] OR show_genre in ["Comedy", "Family"]) AND ' +
        '(rating in ["TV-Y"] OR show_rating in ["TV-Y"]) AND ' +
        '(studio in ["NBC"] OR show_studio in ["NBC"]) AND ' +
        'year >= 1990 AND year <= 1999 AND minutes >= 20 AND minutes <= 35',
    });
  });

  test('gives an empty query for no rules', () => {
    expect(compileBlueprintRules({})).toEqual({});
  });

  test('targets the show rating index field', () => {
    const filter = parseFilter(
      compileBlueprintRules({ contentRatings: ['TV-G'] }).filterString ?? '',
    );
    expect(JSON.stringify(filter)).toContain('grandparent.rating');
  });
});

describe('blueprintAssignments', () => {
  test('narrows every role to the scope', () => {
    const assignments = blueprintAssignments(NinetiesSitcomsBlueprint, {
      libraryIds: ['lib-1'],
    });
    expect(assignments['sitcoms']?.query).toEqual({
      ...NinetiesSitcomsBlueprint.roles[0]?.query,
      libraryIds: ['lib-1'],
    });
  });

  test('adds nothing without a scope', () => {
    const assignments = blueprintAssignments(NinetiesSitcomsBlueprint, {});
    expect(assignments['sitcoms']?.query).toEqual(
      NinetiesSitcomsBlueprint.roles[0]?.query,
    );
  });
});

describe('blueprintChannelName', () => {
  test('fills the pattern', () => {
    expect(
      blueprintChannelName(
        {
          ...NinetiesSitcomsBlueprint,
          channel: { namePattern: '{name} #{number}' },
        },
        7,
      ),
    ).toBe('90s Sitcoms #7');
  });

  test('defaults to name and number', () => {
    expect(
      blueprintChannelName({ ...NinetiesSitcomsBlueprint, channel: {} }, 3),
    ).toBe('90s Sitcoms 3');
  });
});

describe('parseBlueprintJson', () => {
  const valid = JSON.parse(JSON.stringify(NinetiesSitcomsBlueprint)) as Record<
    string,
    unknown
  >;

  test('refuses a newer version by name', () => {
    const result = parseBlueprintJson({ ...valid, blueprintVersion: 2 });
    expect(result.success).toBe(false);
    expect(!result.success && result.message).toMatch(/version 2/);
  });

  test('refuses a file with no version', () => {
    const { blueprintVersion: _v, ...rest } = valid;
    expect(parseBlueprintJson(rest).success).toBe(false);
  });

  test('refuses non-objects', () => {
    expect(parseBlueprintJson([]).success).toBe(false);
    expect(parseBlueprintJson('x').success).toBe(false);
    expect(parseBlueprintJson(null).success).toBe(false);
  });

  test.each(['libraryIds', 'mediaSourceIds', 'groupingId'])(
    'refuses a query naming %s',
    (field) => {
      const roles = [
        {
          ...NinetiesSitcomsBlueprint.roles[0],
          query: { [field]: field === 'groupingId' ? v4() : ['x'] },
        },
      ];
      const result = parseBlueprintJson({ ...valid, roles });
      expect(result.success).toBe(false);
      expect(!result.success && result.message).toMatch(/by id/);
    },
  );

  test('refuses a slot naming an undefined role', () => {
    const schedule = {
      ...NinetiesSitcomsBlueprint.schedule,
      slots: NinetiesSitcomsBlueprint.schedule.slots.map((s) => ({
        ...s,
        role: 'nope',
      })),
    };
    const result = parseBlueprintJson({ ...valid, schedule });
    expect(result.success).toBe(false);
    expect(!result.success && result.message).toMatch(/"nope"/);
  });

  test('refuses a rule value the DSL cannot quote', () => {
    const roles = [
      {
        ...NinetiesSitcomsBlueprint.roles[0],
        rules: { genres: ['Bad"Genre'] },
      },
    ];
    expect(parseBlueprintJson({ ...valid, roles }).success).toBe(false);
  });
});

describe('blueprintFromSchedule', () => {
  test.each(BuiltInBlueprints.map((b) => [b.id, b] as const))(
    '%s survives channel -> blueprint',
    (_id, blueprint) => {
      const ids = collectionIds(blueprint);
      const collections = Object.fromEntries(
        blueprint.roles.map((r) => [
          ids[r.role] ?? '',
          {
            name: r.label,
            filterString: r.query.filterString,
          },
        ]),
      );
      const result = blueprintFromSchedule({
        name: blueprint.name,
        schedule: resolve(blueprint, ids),
        collections,
      });
      expect(result.success).toBe(true);
      if (!result.success) {
        return;
      }
      const back = result.blueprint;
      const byLabel = (b: Blueprint) =>
        b.roles
          .map((r) => [r.label, r.query.filterString])
          .sort(([a], [b]) => String(a).localeCompare(String(b)));
      expect(byLabel(back)).toEqual(byLabel(blueprint));
      expect(back.schedule.slots.length).toBe(blueprint.schedule.slots.length);
      const labelOf = (b: Blueprint, role: string) =>
        b.roles.find((r) => r.role === role)?.label;
      expect(back.schedule.slots.map((s) => labelOf(back, s.role))).toEqual(
        blueprint.schedule.slots.map((s) => labelOf(blueprint, s.role)),
      );
      expect(blueprintRoleProblems(back)).toEqual([]);
    },
  );

  test('drops slot filler, which is local to the install', () => {
    const ids = collectionIds(NinetiesSitcomsBlueprint);
    const schedule = resolve(NinetiesSitcomsBlueprint, ids);
    if (schedule.type !== 'random') {
      throw new Error('expected random');
    }
    const withFiller: RandomSlotSchedule = {
      ...schedule,
      slots: schedule.slots.map((s) => ({
        ...s,
        filler: [
          {
            types: ['pre'],
            fillerListId: v4(),
            fillerOrder: 'shuffle_prefer_short',
          },
        ],
      })),
    };
    const result = blueprintFromSchedule({
      name: 'x',
      schedule: withFiller,
      collections: { [ids['sitcoms'] ?? '']: { name: 'Sitcoms' } },
    });
    expect(result.success).toBe(true);
    expect(
      result.success && result.blueprint.schedule.slots[0],
    ).not.toHaveProperty('filler');
  });

  test('refuses a slot that does not play a smart collection', () => {
    const result = blueprintFromSchedule({
      name: 'x',
      schedule: {
        type: 'random',
        flexPreference: 'end',
        maxDays: 30,
        padMs: 0,
        padStyle: 'episode',
        randomDistribution: 'uniform',
        lockWeights: false,
        slots: [
          {
            type: 'flex',
            cooldownMs: 0,
            weight: 1,
            durationSpec: { type: 'fixed', durationMs: 1000 },
          },
        ],
      },
      collections: {},
    });
    expect(result).toMatchObject({ success: false, slotIndex: 0 });
  });

  test('refuses a smart collection that no longer exists', () => {
    const ids = collectionIds(NinetiesSitcomsBlueprint);
    const result = blueprintFromSchedule({
      name: 'x',
      schedule: resolve(NinetiesSitcomsBlueprint, ids),
      collections: {},
    });
    expect(result).toMatchObject({ success: false, slotIndex: 0 });
  });

  test('gives two collections with one name two roles', () => {
    const a = v4();
    const b = v4();
    const base = resolve(NinetiesSitcomsBlueprint, { sitcoms: a });
    if (base.type !== 'random') {
      throw new Error('expected random');
    }
    const first = base.slots[0];
    if (first?.type !== 'smart-collection') {
      throw new Error('expected a smart collection slot');
    }
    const result = blueprintFromSchedule({
      name: 'x',
      schedule: {
        ...base,
        slots: [first, { ...first, id: v4(), smartCollectionId: b }],
      },
      collections: { [a]: { name: 'Same' }, [b]: { name: 'Same' } },
    });
    expect(result.success && result.blueprint.roles.map((r) => r.role)).toEqual(
      ['same', 'same-2'],
    );
  });
});
