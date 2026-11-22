import type {
  Blueprint,
  BlueprintRole,
  BlueprintRules,
  BlueprintScope,
  ChannelPreset,
  ContentAssignment,
  ContentQuery,
  RandomSlotSchedule,
  RoleRandomSlot,
  RoleTimeSlot,
  ScheduleSkeleton,
  TimeSlotSchedule,
} from '@tunarr/types/api';
import { BlueprintSchema, CurrentBlueprintVersion } from '@tunarr/types/api';
import { v4 as randomUUID } from 'uuid';

// Blueprints: channel recipes that name rules, not programs
// (plans/channel-blueprints.md). This module is pure, so the web app can use
// it too: it must not import Node built-ins.

const HourMs = 60 * 60 * 1000;
const DayMs = 24 * HourMs;
const MinuteMs = 60 * 1000;

//
// Rules -> search DSL
//

function quoted(values: string[]) {
  return `[${values.map((v) => `"${v}"`).join(', ')}]`;
}

/**
 * Compiles structured rules to the search DSL. A rule on an episode reads the
 * show's field too (`show_genre`, `show_rating`, `show_studio`), because an
 * episode's own genre, rating and studio are usually empty.
 */
export function compileBlueprintRules(rules: BlueprintRules): ContentQuery {
  const clauses: string[] = [];
  const either = (field: string, showField: string, values: string[]) =>
    `(${field} in ${quoted(values)} OR ${showField} in ${quoted(values)})`;

  if (rules.genres?.length) {
    clauses.push(either('genre', 'show_genre', rules.genres));
  }
  if (rules.contentRatings?.length) {
    clauses.push(either('rating', 'show_rating', rules.contentRatings));
  }
  if (rules.studios?.length) {
    clauses.push(either('studio', 'show_studio', rules.studios));
  }
  if (rules.yearFrom !== undefined) {
    clauses.push(`year >= ${rules.yearFrom}`);
  }
  if (rules.yearTo !== undefined) {
    clauses.push(`year <= ${rules.yearTo}`);
  }
  if (rules.minMinutes !== undefined) {
    clauses.push(`minutes >= ${rules.minMinutes}`);
  }
  if (rules.maxMinutes !== undefined) {
    clauses.push(`minutes <= ${rules.maxMinutes}`);
  }

  const query: ContentQuery = {};
  if (clauses.length > 0) {
    query.filterString = clauses.join(' AND ');
  }
  if (rules.programTypes?.length) {
    query.programTypes = rules.programTypes;
  }
  return query;
}

function role(
  id: string,
  label: string,
  rules: BlueprintRules,
  minPrograms = 1,
): BlueprintRole {
  return {
    role: id,
    label,
    rules,
    query: compileBlueprintRules(rules),
    minPrograms,
  };
}

//
// Schedule builders
//

function timeSlot(
  roleId: string,
  startTime: number,
  order: RoleTimeSlot['order'] = 'shuffle',
): RoleTimeSlot {
  return {
    id: randomUUID(),
    type: 'role',
    role: roleId,
    startTime,
    order,
    direction: 'asc',
  };
}

function timeSchedule(
  period: 'day' | 'week',
  slots: RoleTimeSlot[],
  padMs = 1,
): Extract<ScheduleSkeleton, { type: 'time' }> {
  return {
    type: 'time',
    flexPreference: 'end',
    period,
    maxDays: 30,
    // The time slot scheduler pads with a modulo, so zero is invalid. One
    // millisecond means no padding.
    padMs,
    latenessMs: 15 * MinuteMs,
    overflow: { type: 'duration', maxMs: 0 },
    timeZoneOffset: 0,
    slots,
  };
}

function randomSlot(
  roleId: string,
  weight = 1,
  order: RoleRandomSlot['order'] = 'shuffle',
): RoleRandomSlot {
  return {
    id: randomUUID(),
    type: 'role',
    role: roleId,
    order,
    direction: 'asc',
    cooldownMs: 0,
    weight,
    durationSpec: { type: 'dynamic', programCount: 1 },
  };
}

function randomSchedule(
  slots: RoleRandomSlot[],
): Extract<ScheduleSkeleton, { type: 'random' }> {
  const weighted = new Set(slots.map((s) => s.weight)).size > 1;
  return {
    type: 'random',
    flexPreference: 'end',
    maxDays: 30,
    padMs: 0,
    padStyle: 'episode',
    randomDistribution: weighted ? 'weighted' : 'uniform',
    lockWeights: false,
    slots,
  };
}

// dayjs starts a week on Sunday, which is how a week-period time slot counts.
function weekTime(day: number, hour: number) {
  return day * DayMs + hour * HourMs;
}

//
// Built-in blueprints
//
// Each is parsed once here, so it carries the schema's defaults and equals its
// own exported JSON read back in.

const KidsRatings = ['TV-Y', 'TV-Y7', 'TV-G', 'G'];

export const SaturdayMorningCartoonsBlueprint: Blueprint =
  BlueprintSchema.parse({
    blueprintVersion: CurrentBlueprintVersion,
    id: 'saturday-morning-cartoons',
    name: 'Saturday-Morning Cartoons',
    description:
      'Animated shows Saturday and Sunday from 7 to 11 AM, and family-friendly shows the rest of the week.',
    category: 'classic-tv',
    channel: { namePattern: 'Cartoons {number}' },
    roles: [
      role('cartoons', 'Weekend-morning cartoons', {
        programTypes: ['episode'],
        genres: ['Animation'],
        contentRatings: KidsRatings,
      }),
      role('family', 'The rest of the week', {
        programTypes: ['episode', 'movie'],
        contentRatings: [...KidsRatings, 'TV-PG', 'PG'],
      }),
    ],
    schedule: timeSchedule('week', [
      ...[0, 1, 2, 3, 4, 5, 6].map((day) =>
        timeSlot('family', weekTime(day, 0)),
      ),
      timeSlot('cartoons', weekTime(6, 7)),
      timeSlot('family', weekTime(6, 11)),
      timeSlot('cartoons', weekTime(0, 7)),
      timeSlot('family', weekTime(0, 11)),
    ]),
    rebuildEachCycle: true,
  });

export const NinetiesSitcomsBlueprint: Blueprint = BlueprintSchema.parse({
  blueprintVersion: CurrentBlueprintVersion,
  id: '90s-sitcoms',
  name: '90s Sitcoms',
  description: 'Half-hour comedies from the 1990s, shuffled all day.',
  category: 'decade',
  channel: { namePattern: '90s Sitcoms' },
  roles: [
    role('sitcoms', 'Sitcoms', {
      programTypes: ['episode'],
      genres: ['Comedy'],
      yearFrom: 1990,
      yearTo: 1999,
      minMinutes: 15,
      maxMinutes: 40,
    }),
  ],
  schedule: randomSchedule([randomSlot('sitcoms')]),
  rebuildEachCycle: true,
});

export const MovieNightBlueprint: Blueprint = BlueprintSchema.parse({
  blueprintVersion: CurrentBlueprintVersion,
  id: 'movie-night-at-8',
  name: 'Movie Night at 8',
  description:
    'A movie every night at 8 PM, with shows before and after. Programs start on the half hour.',
  category: 'movie',
  channel: { namePattern: 'Movie Night {number}' },
  roles: [
    role('movies', 'The 8 PM movie', {
      programTypes: ['movie'],
      minMinutes: 70,
    }),
    role('shows', 'Shows around it', { programTypes: ['episode'] }),
  ],
  schedule: timeSchedule(
    'day',
    [
      timeSlot('shows', 0),
      timeSlot('movies', 20 * HourMs),
      timeSlot('shows', 22 * HourMs + 30 * MinuteMs),
    ],
    30 * MinuteMs,
  ),
  rebuildEachCycle: true,
});

export const HourlyRotationBlueprint: Blueprint = BlueprintSchema.parse({
  blueprintVersion: CurrentBlueprintVersion,
  id: 'hourly-rotation',
  name: 'Hourly Rotation',
  description:
    'Short programs that start on the hour and half hour, like a news channel. Every hour is shuffled afresh.',
  category: 'simple',
  channel: { namePattern: 'Rotation {number}' },
  roles: [
    role('short', 'Short programs', {
      programTypes: ['episode', 'other_video', 'music_video'],
      maxMinutes: 30,
    }),
  ],
  schedule: timeSchedule(
    'day',
    Array.from({ length: 24 }, (_, hour) => timeSlot('short', hour * HourMs)),
    30 * MinuteMs,
  ),
  rebuildEachCycle: true,
});

export const KidsAllDayBlueprint: Blueprint = BlueprintSchema.parse({
  blueprintVersion: CurrentBlueprintVersion,
  id: 'kids-all-day',
  name: 'Kids All Day',
  description: 'Kids’ shows and family movies, shuffled around the clock.',
  category: 'genre',
  channel: { namePattern: 'Kids {number}' },
  roles: [
    role('kids', 'Kids’ shows and movies', {
      programTypes: ['episode', 'movie'],
      contentRatings: [...KidsRatings, 'TV-Y7-FV', 'PG'],
    }),
  ],
  schedule: randomSchedule([randomSlot('kids')]),
  rebuildEachCycle: true,
});

export const ComfortTvBlueprint: Blueprint = BlueprintSchema.parse({
  blueprintVersion: CurrentBlueprintVersion,
  id: 'comfort-tv',
  name: 'Comfort TV',
  description:
    'Sitcoms most of the time, with family shows mixed in. Three sitcom episodes for every family one.',
  category: 'genre',
  channel: { namePattern: 'Comfort TV' },
  roles: [
    role('sitcoms', 'Sitcoms', {
      programTypes: ['episode'],
      genres: ['Comedy'],
      maxMinutes: 40,
    }),
    role('family', 'Family shows', {
      programTypes: ['episode'],
      genres: ['Family', 'Animation'],
    }),
  ],
  schedule: randomSchedule([randomSlot('sitcoms', 3), randomSlot('family', 1)]),
  rebuildEachCycle: true,
});

export const BuiltInBlueprints: Blueprint[] = [
  SaturdayMorningCartoonsBlueprint,
  NinetiesSitcomsBlueprint,
  MovieNightBlueprint,
  HourlyRotationBlueprint,
  KidsAllDayBlueprint,
  ComfortTvBlueprint,
];

export function getBuiltInBlueprint(id: string): Blueprint | undefined {
  return BuiltInBlueprints.find((b) => b.id === id);
}

//
// Blueprint -> auto-channel preset
//

/**
 * The preset a blueprint compiles to. Every role is required, and a role with
 * no query is allowed to span the whole library or the chosen scope, as the
 * 24/7 Shuffle preset's role does.
 */
export function blueprintToPreset(blueprint: Blueprint): ChannelPreset {
  return {
    id: `blueprint:${blueprint.id}`,
    name: blueprint.name,
    description: blueprint.description,
    category: blueprint.category,
    contentRequirements: blueprint.roles.map((r) => ({
      role: r.role,
      label: r.label,
      description: r.description,
      defaultQuery: r.query,
      required: true,
      minPrograms: r.minPrograms,
    })),
    scheduleType: blueprint.schedule.type,
    scheduleConfig: blueprint.schedule,
  };
}

/** Each role's query, narrowed to the libraries and sources in `scope`. */
export function blueprintAssignments(
  blueprint: Blueprint,
  scope: BlueprintScope | undefined,
): Record<string, ContentAssignment> {
  return Object.fromEntries(
    blueprint.roles.map((r) => [
      r.role,
      {
        query: {
          ...r.query,
          ...(scope?.libraryIds?.length
            ? { libraryIds: scope.libraryIds }
            : {}),
          ...(scope?.mediaSourceIds?.length
            ? { mediaSourceIds: scope.mediaSourceIds }
            : {}),
        },
      },
    ]),
  );
}

/** The channel name a blueprint gives a channel numbered `number`. */
export function blueprintChannelName(blueprint: Blueprint, number: number) {
  const pattern = blueprint.channel.namePattern ?? '{name} {number}';
  return pattern
    .replaceAll('{name}', blueprint.name)
    .replaceAll('{number}', String(number));
}

/**
 * Role names the schedule uses but no role defines, and roles no slot uses.
 * Either makes the blueprint unusable: the first points a slot at nothing,
 * the second builds a collection nothing airs.
 */
export function blueprintRoleProblems(blueprint: Blueprint): string[] {
  const defined = new Set(blueprint.roles.map((r) => r.role));
  const slots: { role: string }[] = blueprint.schedule.slots;
  const used = new Set(slots.map((s) => s.role));
  const problems: string[] = [];
  for (const r of used) {
    if (!defined.has(r)) {
      problems.push(`A schedule slot names role "${r}", which is not defined`);
    }
  }
  for (const r of defined) {
    if (!used.has(r)) {
      problems.push(`Role "${r}" is not used by any schedule slot`);
    }
  }
  if (defined.size !== blueprint.roles.length) {
    problems.push('Two roles share a name');
  }
  return problems;
}

//
// Import
//

export type BlueprintParseResult =
  | { success: true; blueprint: Blueprint }
  | { success: false; message: string };

/**
 * Validates a blueprint from a file. A newer `blueprintVersion` is refused by
 * name rather than parsed in part, and local ids in a query are refused
 * because they mean nothing on another install.
 */
export function parseBlueprintJson(input: unknown): BlueprintParseResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { success: false, message: 'A blueprint must be a JSON object' };
  }

  const version = (input as { blueprintVersion?: unknown }).blueprintVersion;
  if (typeof version !== 'number') {
    return {
      success: false,
      message: 'This file has no blueprintVersion, so it is not a blueprint',
    };
  }
  if (version > CurrentBlueprintVersion) {
    return {
      success: false,
      message: `This blueprint is version ${version}, and this Tunarr reads up to version ${CurrentBlueprintVersion}. Update Tunarr to import it.`,
    };
  }

  const roles = (input as { roles?: unknown }).roles;
  if (Array.isArray(roles)) {
    for (const r of roles) {
      const query = (r as { query?: Record<string, unknown> } | null)?.query;
      if (
        query &&
        typeof query === 'object' &&
        ('libraryIds' in query ||
          'mediaSourceIds' in query ||
          'groupingId' in query)
      ) {
        return {
          success: false,
          message:
            'A blueprint may not name libraries, media sources or shows by id. Remove them and choose a scope when creating the channel.',
        };
      }
    }
  }

  const parsed = BlueprintSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues
        .map((i) => `${i.path.join('.') || 'blueprint'}: ${i.message}`)
        .join('; '),
    };
  }

  const problems = blueprintRoleProblems(parsed.data);
  if (problems.length > 0) {
    return { success: false, message: problems.join('; ') };
  }

  return { success: true, blueprint: parsed.data };
}

//
// Channel -> blueprint
//

export type BlueprintCollection = {
  name: string;
  filterString?: string;
  keywords?: string;
};

export type BlueprintFromScheduleResult =
  | { success: true; blueprint: Blueprint }
  | { success: false; message: string; slotIndex?: number };

function roleIdFor(name: string, taken: Set<string>) {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'role';
  let id = base;
  for (let n = 2; taken.has(id); n++) {
    id = `${base}-${n}`;
  }
  taken.add(id);
  return id;
}

/**
 * Builds a blueprint from a saved slot schedule. Every slot must play a smart
 * collection; each distinct collection becomes a role whose query is the
 * collection's. Filler lists are local to the install, so slot filler is
 * dropped.
 */
export function blueprintFromSchedule(input: {
  name: string;
  description?: string;
  schedule: TimeSlotSchedule | RandomSlotSchedule;
  collections: Record<string, BlueprintCollection>;
}): BlueprintFromScheduleResult {
  const { schedule, collections } = input;
  const roleByCollection = new Map<string, string>();
  const taken = new Set<string>();
  const roles: BlueprintRole[] = [];

  for (const [index, slot] of schedule.slots.entries()) {
    if (slot.type !== 'smart-collection') {
      return {
        success: false,
        slotIndex: index,
        message: `Slot ${index + 1} plays a ${slot.type} slot. Only channels whose slots all play smart collections can be saved as a blueprint.`,
      };
    }
    if (roleByCollection.has(slot.smartCollectionId)) {
      continue;
    }
    const collection = collections[slot.smartCollectionId];
    if (!collection) {
      return {
        success: false,
        slotIndex: index,
        message: `Slot ${index + 1} plays a smart collection that no longer exists`,
      };
    }
    const id = roleIdFor(collection.name, taken);
    roleByCollection.set(slot.smartCollectionId, id);
    const query: BlueprintRole['query'] = {};
    if (collection.filterString) {
      query.filterString = collection.filterString;
    }
    if (collection.keywords) {
      query.keywords = collection.keywords;
    }
    roles.push({ role: id, label: collection.name, query, minPrograms: 1 });
  }

  const roleFor = (collectionId: string) => {
    const id = roleByCollection.get(collectionId);
    if (id === undefined) {
      throw new Error(`No role for collection ${collectionId}`);
    }
    return id;
  };

  let skeleton: ScheduleSkeleton;
  if (schedule.type === 'time') {
    const slots: RoleTimeSlot[] = [];
    for (const slot of schedule.slots) {
      if (slot.type === 'smart-collection') {
        const { smartCollectionId, filler: _filler, ...rest } = slot;
        slots.push({
          ...rest,
          id: randomUUID(),
          type: 'role',
          role: roleFor(smartCollectionId),
        });
      }
    }
    skeleton = { ...schedule, slots };
  } else {
    const slots: RoleRandomSlot[] = [];
    for (const slot of schedule.slots) {
      if (slot.type === 'smart-collection') {
        const { smartCollectionId, filler: _filler, ...rest } = slot;
        slots.push({
          ...rest,
          id: randomUUID(),
          type: 'role',
          role: roleFor(smartCollectionId),
        });
      }
    }
    skeleton = { ...schedule, slots };
  }

  const parsed = BlueprintSchema.safeParse({
    blueprintVersion: CurrentBlueprintVersion,
    id: randomUUID(),
    name: input.name,
    description: input.description ?? '',
    category: 'custom',
    channel: {},
    roles,
    schedule: skeleton,
  });
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues.map((i) => i.message).join('; '),
    };
  }
  return { success: true, blueprint: parsed.data };
}
