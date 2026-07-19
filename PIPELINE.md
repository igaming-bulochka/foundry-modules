# Build & publish pipeline (Timeweb CDN)

This repo builds each Foundry module in `packages/*` and publishes it to a
Timeweb S3 bucket fronted by the Timeweb CDN. Foundry installs and updates each
module directly from its CDN manifest URL.

```
push to main / manual dispatch
        │
        ▼
GitHub Actions (.github/workflows/release.yml)
  bun install → bun run build            # every package builds its dist/
        │
        ▼
  node tools/publish/package.mjs         # per module:
        │                                #  - rewrite module.json → CDN URLs
        │                                #  - stage dist/ + lang/ + module.json
        │                                #  - zip (module.json at archive root)
        ▼
  release/
    manifest-index.json      # {id, version} for every module
    <id>/module.json         # latest manifest (no-cache)
    <id>/<id>-<ver>.zip      # versioned artifact (immutable)
        │
        ▼
  aws s3 sync release/ → Timeweb bucket   # served at CDN_BASE/…
        │
        ├─ (optional) ssh staging host → globe-cdn-update.sh   # push autoupdate
        └─ (optional) Timeweb API → purge cached module.json
```

The published `module.json` files are uploaded with `Cache-Control: no-cache`
so Foundry always sees the current version; the versioned zips are immutable.

## One-time Timeweb setup

1. **Object storage (S3):** create a bucket in the Timeweb Cloud console. Note
   its **endpoint** (e.g. `https://s3.twcstorage.ru`), **region** (e.g. `ru-1`),
   and **bucket name**. Create an **S3 access key + secret key** for it.
   > These S3 keys are separate from the Timeweb Cloud **API token** (the JWT).
   > The API token cannot upload objects over the S3 protocol; the S3 keys can.
   The bucket `foundry-modules` (public, hot, `ru-1`) already exists; the first
   release was published to it from local.
2. **Pretty domain / CDN (optional, later):** everything currently uses the raw
   S3 URL `https://s3.twcstorage.ru/foundry-modules` because it works without
   DNS. To move to `https://foundry-modules.schmooky.dev`, CNAME that hostname to
   the bucket (or front it with a Timeweb CDN resource honouring origin
   `Cache-Control`), then set the `CDN_BASE` repo variable and the module's
   **Golarion Tile Data URL** setting to it and republish.
3. If you use a different CDN domain or add a path prefix, set the repository
   variables `CDN_BASE` and `CDN_PATH_PREFIX`, and update the `manifest` /
   `download` fields that ship inside each `packages/<id>/module.json` to match
   (the packaging step also rewrites them, but the in-repo values are the ones a
   fresh manual install reads).

## GitHub configuration

Repository → Settings → Secrets and variables → Actions.

**Secrets (required):**

| Secret | Example |
| --- | --- |
| `TIMEWEB_S3_ENDPOINT` | `https://s3.twcstorage.ru` |
| `TIMEWEB_S3_BUCKET` | `golarion-cdn` |
| `TIMEWEB_S3_ACCESS_KEY` | *(bucket S3 access key)* |
| `TIMEWEB_S3_SECRET_KEY` | *(bucket S3 secret key)* |

**Secrets (optional):**

| Secret | Purpose |
| --- | --- |
| `TIMEWEB_S3_REGION` | S3 region, defaults to `ru-1` |
| `STAGING_HOST`, `STAGING_USER`, `STAGING_SSH_KEY` | push-based staging autoupdate over SSH |
| `TIMEWEB_TOKEN`, `TIMEWEB_CDN_ID` | purge cached manifests via the Cloud API |

**Variables (optional):** `CDN_BASE`, `CDN_PATH_PREFIX`.

Publishing runs automatically on pushes to `main` that touch `packages/**`, or
manually from the Actions tab (with an optional comma-separated `only` list of
module ids).

## Local dry run

```sh
bun install
bun run build
CDN_BASE=https://foundry-modules.schmooky.dev node tools/publish/package.mjs
# inspect release/ — no upload happens without AWS credentials
```

## Installing in Foundry

Use the module's CDN manifest URL in *Install Module → Manifest URL*:

```
https://s3.twcstorage.ru/foundry-modules/globe-map/module.json
```

Foundry re-reads that URL to detect updates. Because manifests are served
`no-cache`, "Check for Updates" reflects a publish within seconds.

> **globe-map map data:** the 305 MB `golarion.pmtiles` and the `terrain/` tiles
> are **not** in the release zip (they live on the Foundry server). A fresh
> install shows the map only once those files are present at
> `Data/modules/globe-map/golarion.pmtiles` (+ `terrain/`). The `earth` tile
> style works without them. Autoupdates never overwrite these files.

## Staging autoupdate

Two ways to keep the staging host current; pick one.

**A. Push-based (immediate).** Set `STAGING_HOST` / `STAGING_USER` /
`STAGING_SSH_KEY`. After each publish, CI SSHes in and runs
`/usr/local/bin/globe-cdn-update.sh`. Install the script and grant the sudo run:

```sh
sudo install -m 755 tools/autoupdate/globe-cdn-update.sh /usr/local/bin/globe-cdn-update.sh
# allow the deploy user to run just this script without a password prompt:
echo 'foundry ALL=(root) NOPASSWD: /usr/local/bin/globe-cdn-update.sh' | sudo tee /etc/sudoers.d/globe-cdn-update
```

**B. Pull-based (polling timer).** No SSH keys in CI; the host checks the CDN
itself every ~10 minutes:

```sh
sudo install -m 755 tools/autoupdate/globe-cdn-update.sh /usr/local/bin/globe-cdn-update.sh
sudo install -m 644 tools/autoupdate/globe-cdn-update.service /etc/systemd/system/
sudo install -m 644 tools/autoupdate/globe-cdn-update.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now globe-cdn-update.timer
```

Useful flags: `--dry-run`, `--force`, `--all` (also install not-yet-installed
modules), `--no-restart`, `--module <id>`. Environment overrides: `CDN_BASE`,
`CDN_PATH_PREFIX`, `MODULES_DIR`, `FVTT_USER`, `FVTT_SERVICE`.

## Security note

The Timeweb Cloud API token pasted during setup was exposed in chat and should
be **rotated** in the Timeweb console. Never commit tokens or S3 keys; they live
only in GitHub Actions secrets.
