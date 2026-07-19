# Foundry VTT Module Workspace

Bun-managed monorepo for Foundry VTT v14 modules used on the Golarion campaign hosted at `foundry.golarion.schmooky.dev`.

## Layout

- `packages/globe-map/` - Interactive Golarion world map (MapLibre GL JS + pf-wikis pmtiles) with pins, pings, party tracking, and click-to-read landmark popups.
- `packages/wheel-of-fate/` - Multi-ring "Wheel of Fate" gambling table: players spend Fate Tokens to spin a nation/deity/form/omen wheel and forge consumables, gear, or unique Golarion-themed artifacts (SVG + GSAP + synthesized WebAudio, GM-authoritative over sockets).

## Build (per package)

```sh
cd packages/<id>
bun run build   # outputs dist/globe-map.{js,css}
```

## Automated deploy (Timeweb CDN)

CI builds every package and publishes it to the Timeweb CDN on pushes to `main`
(or manual dispatch). Foundry installs/updates each module from its CDN manifest
URL, e.g. `https://foundry-modules.schmooky.dev/globe-map/module.json`.
See [PIPELINE.md](PIPELINE.md) for the workflow, required secrets, Timeweb setup,
and the staging autoupdate options.

## Manual deploy (fallback)

```sh
COPYFILE_DISABLE=1 tar --no-mac-metadata -czf /tmp/<id>.tar.gz module.json dist/ lang/ README.md
scp -i ~/.ssh/foundry-golarion_ed25519 -o IdentitiesOnly=yes /tmp/<id>.tar.gz foundry@147.45.189.181:/tmp/
ssh -i ~/.ssh/foundry-golarion_ed25519 -o IdentitiesOnly=yes foundry@147.45.189.181 \
  'sudo tar -xzf /tmp/<id>.tar.gz -C /var/foundrydata-staging/Data/modules/<id>/ && sudo chown -R fvtt:fvtt /var/foundrydata-staging/Data/modules/<id>/ && sudo systemctl restart foundry-staging'
```

Large binary assets (the 305 MB Golarion pmtiles file) live only on the VPS at `/var/foundrydata-staging/Data/modules/globe-map/golarion.pmtiles` and are not committed to this repo. Source for that file is the [pf-wikis/mapping](https://github.com/pf-wikis/mapping) project, distributed under Paizo's [Community Use Policy](https://paizo.com/licenses/communityuse).
