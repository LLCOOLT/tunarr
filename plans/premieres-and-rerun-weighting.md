# Premieres and rerun weighting

Two opt-in slot-schedule settings that act when a cycle is built. Both build on reshuffle on loop
(`schedules-reshuffle-on-loop.md`): they change what the next cycle contains, never what is airing.

## Goals

- **Premieres.** A new episode that a library scan adds to a show a channel draws from airs at a
  chosen time of day, once, before it joins normal rotation. The guide marks the airing.
- **Rerun weighting.** Shuffle slots stop treating every program alike. A program that aired
  recently on the channel comes up later in the next pass, and optionally the programs the Plex
  account has already watched come up later too.
- Same seed and same inputs give the same cycles, so a cascade rebuild reproduces what aired.
- Nothing writes to a media source.

## Non-goals

- Manual lineups, on-demand channels, and custom-show (playlist) slots for premieres.
- Jellyfin and Emby watch state. Only Plex is read; other sources weigh by recency alone.
- Per-viewer weighting. Plex reports the watch state of the account Tunarr is signed in with.

## Settings

Both live on the slot schedule (`TimeSlotSchedule`, `RandomSlotSchedule`), are optional, and read
as off when missing.

```ts
premieres?: {
  enabled: boolean;
  timeOfDayMs: number; // local time, default 20:00
  maxPerDay: number;   // per slot iterator, default 1
};
rerunWeighting?: {
  mode: 'off' | 'least_recent' | 'unwatched';
  strength: number;    // 0..1, default 0.5
};
```

Premieres need `rebuildEachCycle`. A channel that loops one materialized lineup has no later
cycle to place a premiere in, so the scheduler only applies them to cycle builds (requests with an
`endTime`). The editors disable the switch while "Rebuild each cycle" is off.

Rerun weighting works in both modes. On a looping channel it only reorders the passes inside the
one build.

## Premieres

- **Detection.** A program is new when its `program.createdAt` (when Tunarr first saw it) is at or
  after the channel's premiere baseline. The baseline is set to the start of the first cycle built
  with premieres on, so turning the feature on does not premiere the whole library.
- **When.** The premiere moment is `timeOfDay` on the day after detection, in the server's local
  time (the zone the schedulers lay slots out in). A program whose moment passed more than 7 days
  before the cycle start is dropped as a candidate.
- **Where.** In the first slot, at or after the moment, whose iterator draws from a pool that holds
  the program (show and smart-collection slots). The slot airs the premiere instead of its next
  pick, then carries on as usual. The program stays in the pool, so it also comes up in rotation.
- **How many.** At most `maxPerDay` premieres per iterator per local day, ordered by season and
  episode, so a full-season drop premieres one a day.
- **State.** `iteratorState.premieres = { sinceMs, premieredIds, lastDayByKey }`, carried in the
  cycle snapshot like the other iterator state, so a cascade rebuild premieres the same episode at
  the same time. `premieredIds` is pruned to programs still inside their window.
- **Marking.** The scheduler returns `{ programId, atMs }` for each premiere it placed.
  `BuildSlotCycleCommand` sets `premiere: true` on that lineup item. The guide carries it through:
  XMLTV writes `<premiere/>` instead of `<previously-shown/>`, and native playback and the guide
  API report `isPremiere: true`. `<new/>` is not used: the DTD reserves it for a show's first
  episode ever, not a new episode of an existing show.

## Rerun weighting

- Applies to `shuffle` show, smart-collection and custom-show slots. Ordered, `ordered_shuffle` and
  filler slots are unchanged.
- **A pass is a weighted random permutation** (Efraimidis-Spirakis: sort by `log(u) / w`), so every
  program still airs once per pass. Only the order inside the pass changes.
- **Weight.** `w = exp(3 * strength * recency) * (unwatched ? exp(3 * strength) : 1)`.
  `recency` is 1 for a program that aired first in the previous pass, or not at all, falling to 0
  for the one that aired last. `unwatched` only counts in `unwatched` mode.
- **Recency source.** The iterator's own air order. The shuffle snapshot's `playedIds` is kept in
  air order, so the order of the pass that just ended is known without play history.
- **Reproducibility.** Watch state changes all the time, so a weighted pass stores its planned
  order in the snapshot (`order`). A resumed pass follows the stored order instead of shuffling
  again; programs added since are shuffled onto the end. The next pass is weighed with the watch
  state of the build that starts it.
- **Watch state.** `ProgramWatchStateService` reads `viewCount` for the pool's Plex programs with
  batched `GET /library/metadata/{k1,k2,...}` requests, cached for 10 minutes per media source. A
  failed request is logged and treated as "nothing watched".

## Tests

- Premiere placement in the first matching slot at or after the moment, once only, the per-day cap,
  the baseline, the window, and reproduction from a snapshot.
- XMLTV `<premiere/>` and native-playback `isPremiere`.
- Weighted order: determinism for a seed, every program once per pass, recency and unwatched
  shifting the distribution, resume from a stored order.
- The watch-state service only issues GET requests.

## Parity checklist

Adds two rows to `architecture/infinite-schedules/parity-checklist.md`.
