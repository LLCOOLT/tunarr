# Channel Blueprints

> **Status (11/22/2026):** Built on the `plxnative/channel-blueprints` branch of a private fork, which
> is not going upstream. Upstreaming it would need a `design approved` issue first (AGENTS.md:
> new top-level feature, a migration, new cross-package API shapes). Overlaps slice 8 of infinite
> schedules ("shareable templates", [#2103](https://github.com/chrisbenincasa/tunarr/issues/2103)),
> so the design issue must say how the two meet. A draft of the issue is at the end of this file.

A blueprint is a channel recipe that names **rules, not programs**: "half-hour comedies from the
1990s, shuffled, all day". It fits any library, so it can be shared. Creating a channel from a
blueprint runs the auto-channel machinery that already exists (#1805): each rule becomes a smart
collection, and the schedule skeleton becomes a time-slot or random-slot schedule over those
collections.

## Goals

- Pick a ready-made channel from a gallery, preview what it would air, rename or renumber it, and
  create it in one step.
- Save any slot channel built on smart collections as a blueprint, and share it as a JSON file.
- Import a blueprint someone else made, validated before anything is written.
- Built-in blueprints ship as data next to the auto-channel presets.

## Non-goals

- A new scheduler. A blueprint compiles to an `AutoChannelCreateRequest`-equivalent and nothing
  else.
- Manual lineups. A manual lineup is a list of programs, not rules.
- A community gallery service. Sharing is a file; a gallery can come later.
- Live links. A channel created from a blueprint keeps no link to it, as with auto-channel presets
  and infinite-schedule presets (D18). Editing the blueprint later does not change the channel.

## Terms

**Blueprint**: a versioned, shareable channel recipe: roles with content rules, a schedule skeleton
over those roles, and channel defaults. Distinct from a **Preset** (CONTEXT.md), which is a
built-in starting point in Tunarr's code. A built-in blueprint is a preset with its content rules
filled in. Add the term to `CONTEXT.md`.

## How it maps onto what exists

| Blueprint part    | Existing piece it compiles to                                                    |
| ----------------- | -------------------------------------------------------------------------------- |
| Roles             | `ContentRequirement` (`types/src/api/AutoChannel.ts`)                            |
| Content rules     | `ContentQuery.filterString`, the search DSL (`shared/src/util/searchUtil.ts`)    |
| Schedule skeleton | `ScheduleSkeletonSchema` (role time slots and role random slots)                 |
| Create            | `AutoChannelService.createChannel`, refactored to take a preset value, not an id |
| Smart collections | Created per role by `createChannel`, as today                                    |

Every content rule is expressible in the DSL today:

| Rule                 | DSL                                                          |
| -------------------- | ------------------------------------------------------------ |
| Genres               | `genre = "Comedy"`, `show_genre = "Animation"`               |
| Decade or year range | `year >= 1990 AND year <= 1999`                              |
| Runtime range        | `minutes >= 20 AND minutes <= 35`                            |
| Content ratings      | `rating = "TV-Y" OR rating = "TV-G"` (see note)              |
| Movies or episodes   | `programTypes` on the query                                  |
| Studio or network    | `studio = "…"`, `show_studio = "…"`                          |
| Library or source    | `libraryIds`, `mediaSourceIds` on the query (never exported) |

Note on ratings: the index keeps a content rating on movies and shows, but an episode's own
`rating` is often null and the show's sits under `grandparent.rating` (`MeilisearchService.ts`).
The DSL has no `show_rating` field, so `rating = "TV-Y"` can miss episodes. PR 1 either adds
`show_rating` (mapped to `grandparent.rating`, like `show_genre`) or compiles a rating rule to the
show-level field for episode roles. Check this against a real index before choosing.

A blueprint stores the structured rules **and** the compiled `filterString`. The structured form
drives the editor; the string is what runs. An imported blueprint with only a `filterString` is
valid, so a hand-written one works too.

## Schema (`types/src/api/Blueprint.ts`)

```ts
BlueprintSchema = z.object({
  blueprintVersion: z.literal(1),
  id: z.string(), // built-in slug, or uuid for user blueprints
  name: z.string().min(1),
  description: z.string(),
  category: ChannelPresetCategorySchema,
  channel: z.object({
    namePattern: z.string().optional(), // "{name} {number}" by default
    numberHint: z.number().int().positive().optional(),
    icon: z.string().url().optional(),
    offline: ChannelOfflineSchema.partial().optional(),
  }),
  roles: z.array(
    z.object({
      role: z.string(),
      label: z.string(),
      rules: BlueprintRulesSchema.optional(), // structured form, editor only
      query: ContentQuerySchema.omit({
        libraryIds,
        mediaSourceIds,
        groupingId,
      }),
      minPrograms: z.number().min(0),
    }),
  ),
  schedule: ScheduleSkeletonSchema, // role slots, dayparts, padMs, flexPreference
  rebuildEachCycle: z.boolean().optional(), // forward-compatible, see below
});
```

- Library, source and grouping ids are local to one install. Export strips them, and the create
  dialog asks for a scope instead.
- Transcode configs and filler lists are local too. Neither is in the file. The channel gets the
  default transcode config, as auto channels do now.
- `rebuildEachCycle` is carried and written to the lineup when the server supports it
  (`plans/schedules-reshuffle-on-loop.md`). On a server without it the field is ignored.

### Versioning

- `blueprintVersion` is a literal. Import rejects a higher version with a 400 that names it
  ("this blueprint needs a newer Tunarr"), and never partially reads it.
- A future v2 adds a migrator from v1, in the style of `ChannelLineupMigrator`.

## Built-in blueprints (`shared/src/channel-templates/blueprints.ts`)

| Blueprint                  | Skeleton                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Saturday-morning cartoons  | Time slots, week period: Sat and Sun 07:00–11:00 animation (TV-Y, TV-Y7, TV-G), shuffle; rest of the week random kids' content |
| 90s sitcoms                | Random slots, comedy episodes 1990–1999, 20–35 min, block shuffle by show                                                      |
| Movie night at 8           | Time slots, day period: 20:00 one movie, pad to :00; shows before and after                                                    |
| Hourly news-style rotation | Time slots, every hour on the hour, 1 h of shuffled short content, pad to :00                                                  |
| Kids all day               | Random slots, TV-Y/TV-Y7/TV-G/G/PG, shuffle                                                                                    |
| Comfort TV                 | Random slots, comedy and family episodes, two weighted slots (sitcoms 3, family 1)                                             |

A test compiles every built-in with `createChannel`'s validation and the DSL parser, so a built-in
cannot drift from the preset schema.

## API (`server/src/api/blueprintsApi.ts`)

| Method and path                       | Does                                                                         |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| `GET /api/blueprints`                 | Built-ins and saved user blueprints                                          |
| `POST /api/blueprints/preview`        | `{ blueprint, scope }` → `previewContent` per role                           |
| `POST /api/blueprints/create-channel` | `{ blueprint, scope, channelName?, channelNumber?, seed? }` → `Channel`      |
| `POST /api/blueprints/import`         | Validates a blueprint JSON and saves it                                      |
| `GET /api/blueprints/:id/export`      | The saved blueprint as a JSON file                                           |
| `GET /api/channels/:id/blueprint`     | Builds a blueprint from a slot channel whose slots are all smart collections |
| `DELETE /api/blueprints/:id`          | Deletes a user blueprint; built-ins are read-only                            |

- Export from a channel reads its schedule: each distinct smart-collection slot becomes a role,
  and the collection's query becomes the role's `query`. It works on any such channel, auto-created
  or not. A channel with show, playlist or filler-list slots returns 422 with the slot that blocks
  it.
- Preview has no sample of what would air. The slot scheduler reads programs through saved smart
  collections (`SlotSchedulerHelper.materializeSmartCollections`), so a sample needs either
  collections written for a preview or a scheduler entry point that takes programs per slot. Left
  out until one of those exists.

## Persistence

- One Drizzle table, `channel_blueprint`: `uuid`, `name`, `body` (the JSON), `created_at`,
  `updated_at`. Generated with `pnpm drizzle-kit generate`.
- Built-ins are not stored; they ship in code.

## Web

- Channel creation gains a **Start from a blueprint** step: a gallery grouped by category, then a
  preview (counts per role, top shows), then name, number and library scope, then
  Create.
- **Import blueprint** (file picker) on the gallery, **Save as blueprint** and **Export** on a slot
  channel's page.
- Reuse `web/src/components/auto-channel/` (content pickers, `BlockConfigurator`). Strings go
  through lingui.
- New routes go into `e2e/tests/routes.ts`.

## Tests

- Schema round-trip: parse → serialize → parse is identical for every built-in.
- Import rejects an unknown `blueprintVersion`, local ids, and a role the schedule does not name.
- Every built-in compiles: its DSL parses and its skeleton passes `createChannel`'s validation.
- Channel → blueprint → channel reproduces the same slots and queries.
- API tests in the style of `autoChannelApi.test.ts`.

## PR plan

1. Types and built-ins: `BlueprintSchema`, the built-in list, round-trip and compile tests. No
   server or web change.
2. `AutoChannelService.createChannel` takes a preset value; `/blueprints` list, preview and create.
3. Migration, import, export, channel → blueprint.
4. Web gallery, import and export.

Each PR stays under the 500-line limit outside tests.

## Open questions

- **How this meets #2103.** Slice 8 of infinite schedules plans shareable templates. Either a
  blueprint v2 targets infinite schedules (roles become library slots, the skeleton becomes
  placements), or blueprints wait for slice 8. The design issue must settle this with the
  maintainer before PR 1.
- Whether `rebuildEachCycle` should default to on for built-ins once reshuffle-on-loop ships.
- Whether the gallery belongs in the auto-channel dialog or in a new top-level page.

## Design issue draft

For `.github/ISSUE_TEMPLATE/design_proposal.yaml`. The user files it and owns it.

**Problem.** Auto channels (#1805) make a channel from a preset, but the user must fill in every
role's content each time, and nothing can be saved or shared. A channel someone builds by hand
cannot be reused on another install, because its slots point at local smart collections.

**Approach.** A blueprint is a preset with its content rules filled in as DSL queries, versioned
and stored as JSON. Creating a channel from one runs `AutoChannelService.createChannel`
unchanged except that it takes a preset value. Export reads a slot channel's smart-collection
queries back into a blueprint. Rejected: a separate scheduler (duplicates the slot schedulers);
storing program ids (not portable); waiting for infinite-schedule templates only (#2103 is not
started, and blueprints can migrate to it, see Open questions).

**What changes.** `types` (new schema), `shared` (built-ins), `server` (one service method
refactor, one API module, one table), `web` (gallery, import and export).

**PR plan.** The four PRs above.

**AI use.** Claude Code drafted this design and the plan in `plans/channel-blueprints.md`.
