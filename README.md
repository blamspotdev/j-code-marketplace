# j-code-marketplace

Extension marketplace for JCode — language packs, templates, and (later)
theme / icon-set extensions.

Extension **sources** are git submodules under `extensions/`. Each of those repos
compiles itself with [`jext`](https://github.com/blamspotdev/j-code-make-tools) on
every merge and attaches the resulting **unsigned** `.jext` to its own Releases.
This repo is where those packages get **signed** and **published**: the
[Sync dist_v2](.github/workflows/sync-dist-v2.yml) workflow, run by hand, pulls each
extension's latest release, signs it with the marketplace key, drops it in `dist_v2/`
and regenerates [`marketplace_v2.yaml`](marketplace_v2.yaml). The JCode app reads that
index to browse, then **downloads and verifies** the chosen `.jext` to install it.

```
marketplace_v2.yaml            # index JCode 1.7.0+ reads: entry -> dist_v2/<id>-<ver>.jext
dist_v2/                       # signed .jext packages (what the app installs)
  jcode.lang.python-0.2.4.jext
  icons/                       # extracted at index time, shown before install
marketplace.yaml               # FROZEN v1 index — what 1.6.x and earlier read
dist/                          # FROZEN v1 packages; leave both where they are
extensions/                    # submodule SOURCES (where extensions are developed)
  template-1/    -> j-code-ext-template-1   (type: templates)
  csharp/        -> j-code-ext-csharp       (type: language)
  javascript/    -> j-code-ext-javascript   (type: language)
  typescript/    -> j-code-ext-typescript   (type: language)
```

Each extension source carries an `extension.jehm` **header** (metadata — see the
[JEHM spec](https://github.com/blamspotdev/j-code-make-tools/blob/main/docs/JEHM-SPEC.md))
and an `extension.yaml` **functional manifest**.

## Clone

```bash
git clone --recurse-submodules https://github.com/blamspotdev/j-code-marketplace.git
# or, after a plain clone:
git submodule update --init --recursive
```

## Extension types

- **language** — editor coding suggestions, a basic formatter, and helpers
  (`extension.yaml` with a `language:` block).
- **templates** — project templates scaffolded on-device (`extension.yaml` +
  `templates/<id>/template.yaml`).

## Add / update an extension

> **New here?** [**CREATING-EXTENSIONS.md**](CREATING-EXTENSIONS.md) is the full,
> step-by-step walkthrough (header + manifest schemas, `language`/`templates`
> examples, icons, publishing, and how the app installs). Quick version:

1. Create a `j-code-ext-<name>` repo with an `extension.jehm` header (`jext init`)
   and an `extension.yaml` manifest.
2. `git submodule add -b main <repo-url> extensions/<name>`.
3. Merge a PR in that repo. Its own CI bumps the patch version, packs the `.jext`
   and publishes it to that repo's Releases — unsigned.
4. Run **Sync dist_v2** here (Actions → Sync dist_v2 → Run workflow). It signs every
   release that is newer than what `dist_v2/` holds, reindexes, and commits. Use the
   **dry-run** input first if you want to see what it would pick up.

The two pairs are deliberate: `dist/` + `marketplace.yaml` stay exactly as 1.6.x left
them so installs already in people's hands keep resolving, while `dist_v2/` +
`marketplace_v2.yaml` are what 1.7.0 onward reads. Only ever add to v2.

### Why the sync signs, and CI does not

A signature means *reviewed and approved by the marketplace maintainer* — it is the
root of trust for code that runs inside JCode's own process, and the app refuses to
load a native extension's dex without it. The extension repos are public and their CI
only ever produces plain packages; the key lives in this repo's `JCODE_SIGNING_KEY`
secret and is used by the one workflow that publishes.
