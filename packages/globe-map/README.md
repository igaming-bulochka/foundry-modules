# Globe Map

Interactive Golarion world map for Foundry VTT v13/v14, built for Pathfinder 2e
and Kingmaker. Track the party, pin locations, plan journeys, and drop a
Kingmaker hex crawl anywhere on the map.

## Features

- **Globe or flat projection**, toggleable in the toolbar; each user's last
  choice is remembered. Set the world default in settings.
- **Kingmaker hex overlay** (flat mode only): a configurable pointy/flat-top hex
  grid with A1/B2 labels. Right-click → "Center hex grid here" to position it,
  or open the hex config dialog for size, extent, colour, and opacity.
- **Pins with icons and colour.** Curated icon palette (city, castle, dungeon,
  temple, danger, treasure, …) plus any custom FontAwesome class. Drag to move,
  double-click to edit, right-click for options.
- **Party tracking** with a pulsing marker that all players see live.
- **Journey timeline**: waypoints with travel mode (each with its own icon),
  dates, distance (haversine miles) and day totals. Drag markers to reposition,
  drag cards to reorder, or use the panel controls.
- **Pings**: shift-click anywhere for a ripple in your player colour, broadcast
  to everyone.
- **3D terrain** relief synthesized from the biome/mountain data.
- **Rich landmark popups** rendering PathfinderWiki article bodies (sanitised)
  with a source link.
- **Realtime + multiplayer-safe** via [socketlib]: players' edits are persisted
  through the GM automatically (falls back to `game.socket` if socketlib is
  absent).
- **Live coordinate / hex readout** in the corner.
- Animations throughout (pin drops, hover, pulses, menus) with a personal
  **reduce-motion** toggle.

## Configuration (Settings → Module Settings → Globe Map)

- **Map tile style** — `golarion` (bundled), `earth` (demo), or any style.json URL
- **Initial center / zoom** and **default projection**
- **Sidebar button**: show/hide, its icon, and whether it nests under a shared
  **Campaign Tools** folder (with its own configurable name + icon)
- **Personal override**: opt out of the global toolbar settings and use your own
  button/folder just for yourself
- **Party marker icon**, **default pin icon**, **default pin colour**
- **Enable animations** (personal / reduced motion)
- **Create Open-Map Macro** button, and an **Open Globe Map** keybinding
  (unbound by default; set it in Configure Controls)

## Open the map

- The configurable button in the scene controls toolbar
- The **Open Globe Map** keybinding (once you bind it)
- A macro: `GlobeMap.open()` — or click *Create Macro* in settings
- API: `game.modules.get("globe-map").api.open()` (also `.close()`, `.toggle()`)

## Permissions

- Anyone can ping and fly-to waypoints. With socketlib, player edits route
  through the GM for persistence.
- GM: add/edit/delete pins and waypoints, move the party, configure the hex grid.

## Map data (self-hosted Golarion tiles)

The 305 MB `golarion.pmtiles` and the `terrain/` tiles are **not** shipped in
the release zip. They must exist on the Foundry server at
`Data/modules/globe-map/golarion.pmtiles` (+ `terrain/`). Source: the
[pf-wikis/mapping](https://github.com/pf-wikis/mapping) project under Paizo's
[Community Use Policy](https://paizo.com/licenses/communityuse). The `earth`
style needs no local data.

## Build

```sh
bun install
bun run build        # → dist/globe-map.{js,css}
bun run typecheck    # tsc --noEmit
```

## Credits

Inspired by [Ikaguia/fvtt-globe-map](https://github.com/Ikaguia/fvtt-globe-map).
Independent implementation for v13/v14, written from scratch. Uses
[MapLibre GL JS], [pmtiles], [DOMPurify], and [socketlib].

[socketlib]: https://github.com/manuelVo/foundryvtt-socketlib
[MapLibre GL JS]: https://maplibre.org/
[pmtiles]: https://github.com/protomaps/PMTiles
[DOMPurify]: https://github.com/cure53/DOMPurify
