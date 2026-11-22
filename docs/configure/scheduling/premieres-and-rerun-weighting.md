# Premieres and Rerun Weighting

Time slot and random slot schedules have two optional settings below **Rebuild each cycle** in the
slot editor. Both change what the next cycle contains. Neither changes what is airing now.

## Premiere new episodes

When a library scan adds a new episode of a show the schedule plays, the episode premieres: it airs
at the **Premiere time** (8:00 PM by default) on the day after Tunarr first sees it, then joins the
normal rotation.

- **Requires Rebuild each cycle.** A schedule that loops one fixed lineup has no later cycle to put
  the premiere in, so the switch is disabled until Rebuild each cycle is on.
- **Where it airs.** In the first slot, at or after the premiere time, that plays the episode's
  show or smart collection. If that slot only airs in the morning, the premiere airs the next
  morning. Custom show (playlist) slots never premiere.
- **Only new episodes.** Episodes Tunarr already had when you turned the setting on never premiere.
- **Season drops.** **Premieres per slot per day** (1 by default) limits how many premieres one slot
  airs on one day. With the default, a ten-episode season premieres one episode a day, in episode
  order.
- **Missed premieres.** An episode that no slot reaches within 7 days of its premiere time simply
  joins the rotation.
- **In the guide.** XMLTV marks the airing with `<premiere/>` instead of `<previously-shown/>`.
  The guide API and `GET /api/channels/:id/native-playback` report `isPremiere: true`.

## Rerun weighting

Shuffled slots play every program once before any repeats. Rerun weighting keeps that, but orders
each pass so that what aired recently on the channel comes up later. This makes back-to-back
repeats across a pass boundary rare.

| Setting                                         | Effect                                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Off                                             | A plain shuffle, as before                                                                        |
| Favor what aired longest ago                    | Programs that aired early in the previous pass come up earlier in the next one                    |
| Favor what aired longest ago and unwatched      | Also moves programs your Plex account has already watched later in the pass                       |

**Strength** sets how strongly the order tilts. At 0% the order is a plain shuffle; at 100% the most
favored program is about 20 times as likely as the least favored one to come up first.

- Applies to slots ordered **Shuffle**. Ordered, ordered shuffle and filler slots are unchanged.
- Watch state is read from Plex, for the account Tunarr is signed in with, and refreshed at most
  every 10 minutes. Tunarr only reads it; it never marks anything watched or unwatched. Jellyfin,
  Emby and local programs count as unwatched.
- Works with or without Rebuild each cycle. Without it, the weighting only orders the passes inside
  the one lineup Tunarr builds.
