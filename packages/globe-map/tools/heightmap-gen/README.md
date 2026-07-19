# heightmap-gen

One-shot synthesizer that builds the Golarion terrain tile set served by
`globe-map`. There is no real elevation data for Golarion, so the script
infers heights from the pf-wikis pmtiles:

- **Polygon biome color** is mapped to a base elevation (mountains live in
  the dim/dark browns and greys, plains in the light tans and creams,
  water in the blues). The mapping is hand-tuned from sampling the live
  archive; see the `ELEV` table in `generate.mjs`.
- **Labels matching `/mountain|peak|range|.../i`** add a radial bump on
  top of the base biome so named ranges (e.g. Brazen Peaks, Sankyodai
  Mountains) rise where the canon says they should.
- **Line-labels with mountain names** are sampled along their geometry so
  ridges form along their length, not just at one centroid.
- Simplex noise + a small box blur smooth seams and add slope variation
  weighted by elevation.
- The whole thing is clamped to [-300m, 6500m] so a few overlapping
  bumps cannot punch through the stratosphere.

The output is Terrarium-encoded PNG tiles for z=0..5 (1365 tiles, ~17 MB)
under `/tmp/golarion-terrain/`. MapLibre reads them via a `raster-dem`
source declared in `../../src/styles.ts` and feeds them to `setTerrain`
when the user clicks the 3D toggle.

## Run

```bash
cd packages/globe-map/tools/heightmap-gen
bun install
node generate.mjs        # writes /tmp/golarion-terrain/{z}/{x}/{y}.png
node visualize.mjs 0 0 0 # ASCII-preview a single tile
```

`generate.mjs` reads `https://staging.golarion.schmooky.dev/modules/globe-map/golarion.pmtiles`
over HTTP range reads, so you do not need a local copy of the archive.
Run time is ~5 seconds end-to-end.

## Deploy

```bash
tar -czf /tmp/golarion-terrain.tar.gz -C /tmp golarion-terrain
scp /tmp/golarion-terrain.tar.gz foundry@VPS:/tmp/
ssh foundry@VPS '
  cd /tmp && rm -rf golarion-terrain && tar -xzf golarion-terrain.tar.gz
  TARGET=/var/foundrydata-staging/Data/modules/globe-map
  sudo rm -rf $TARGET/terrain
  sudo cp -r /tmp/golarion-terrain $TARGET/terrain
  sudo chown -R fvtt:fvtt $TARGET/terrain
  sudo find $TARGET/terrain -name "._*" -delete
'
```

## Tuning

If a region looks too flat or too sharp, the parameters to twiddle are
all in `generate.mjs`:

| Knob              | Where           | Effect                            |
| ----------------- | --------------- | --------------------------------- |
| `ELEV` map        | top of file     | base elevation per biome color    |
| Mountain bump     | Pass 2          | radius / peak of label bumps      |
| Noise strength    | Pass 3          | per-pixel roughness               |
| `HARD_MAX`        | Pass 5          | global ceiling (default 6500m)    |
| `CANVAS`          | constants block | working resolution (64 MB at 4k)  |

After re-running, redeploy the tiles. The module source does not need to
change unless you adjust the tile URL or encoding.
