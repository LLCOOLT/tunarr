# Blueprints

A blueprint is a channel recipe that names rules, not programs: "half-hour comedies from the 1990s, shuffled all day". Because it holds no program or library ids, a blueprint fits any library and can be shared as a file. Open the gallery with the **BLUEPRINTS** button on the Channels page.

Creating a channel from a blueprint works like [Auto Create](auto-create.md): Tunarr makes one smart collection per role of the blueprint and a slot schedule that plays them.

## Create a channel from a blueprint

1. Pick a blueprint in the gallery.
2. Optionally limit it to one **Media Source** and its **Libraries**. Each role shows how many programs it matches there. A role that matches nothing blocks creating the channel.
3. Optionally set the channel name and number, then **Create Channel**. A blank name follows the blueprint's name pattern; a blank number takes the blueprint's suggested number, or the next free one.

## Built-in blueprints

| Blueprint | Schedule | Plays |
| --------- | -------- | ----- |
| Saturday-Morning Cartoons | Weekly time slots | Animated kids' shows Saturday and Sunday 7–11 AM, family shows the rest of the week |
| 90s Sitcoms | Random slots | Comedy episodes from 1990–1999, 15–40 minutes long |
| Movie Night at 8 | Daily time slots | A movie at 8 PM, shows before and after, programs on the half hour |
| Hourly Rotation | Daily time slots | Programs of up to 30 minutes, starting on the hour and half hour |
| Kids All Day | Random slots | Shows and movies rated TV-Y, TV-Y7, TV-Y7-FV, TV-G, G or PG |
| Comfort TV | Weighted random slots | Sitcoms three times as often as family shows |

Rules that read a genre, content rating or studio also look at the show an episode belongs to (`show_genre`, `show_rating`, `show_studio`), because episodes usually carry none of their own.

## Save, export and import

- **Save as Blueprint** and **Export as Blueprint** in a channel's menu read the channel back as a blueprint. This works for a time-slot or random-slot channel whose slots all play smart collections, such as an auto-created channel. Each smart collection becomes a role. Slot filler lists are left out, because they belong to one install.
- **Export** on a gallery card downloads the blueprint as a `.tunarr-blueprint.json` file.
- **Import Blueprint** on the gallery reads such a file and saves it under **Your blueprints**. A file from a newer version of Tunarr is refused with the version it needs. A file that names libraries, media sources or shows by id is refused too.

A channel keeps no link to the blueprint it came from. Editing or deleting a blueprint does not change channels made from it.
