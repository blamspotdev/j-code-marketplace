# The JCode marketplace

This is where JCode's extensions are published. When someone opens **Extensions**
inside JCode and installs something, this repo is what they are browsing.

Extensions themselves are not written here. Each one lives in its own repository,
and this repo keeps a pointer to every one of them, collects what they publish,
signs it, and lists it.

## How an extension gets to a user

1. **Someone builds an extension** in its own repo — a language pack, a project
   template, a database client, whatever it is.
2. **Its repo packages itself.** Every time a change is merged there, a workflow
   bumps the version, packs the extension into a single `.jext` file, and attaches
   it to that repo's Releases. That package is *unsigned*.
3. **This repo signs it.** Someone runs the [Sync dist_v2](.github/workflows/sync-dist-v2.yml)
   workflow here by hand. It looks at every extension it tracks, downloads any
   release newer than what it already has, signs it with the marketplace key, and
   updates the index.
4. **JCode installs it.** The app reads the index to show what is available, then
   downloads the package and checks the signature before installing.

The signing step is the reason a person has to press the button. See
[below](#why-signing-happens-here).

## What is in this repo

```
marketplace_v2.yaml    the list JCode reads — one entry per extension
dist_v2/               the signed packages the app downloads
  jcode.lang.python-0.2.6.jext
  icons/               pulled out of each package, so the app can show an icon
                       before you install anything
extensions/            a pointer to each extension's own repo (16 of them)
marketplace.yaml       the old list, frozen
dist/                  the old packages, frozen
```

`extensions/` holds git *submodules* — each one is a reference to another
repository rather than a copy of it. Cloning this repo does not bring them along
unless you ask:

```bash
git clone --recurse-submodules https://github.com/blamspotdev/j-code-marketplace.git
# already cloned the plain way?
git submodule update --init --recursive
```

That list is also what the sync workflow works from: an extension that is not a
submodule here is one the marketplace never sees, however often its own repo
publishes.

### The two lists

`marketplace.yaml` and `dist/` are what JCode 1.6.x and earlier read, and they are
frozen exactly as those versions left them so that installs already on people's
phones keep working. `marketplace_v2.yaml` and `dist_v2/` are what 1.7.0 onward
reads. **Only ever add to v2.**

## What an extension can be

Every extension declares a `type`, which tells JCode what it is:

| | |
|---|---|
| `language` | editing support for a language — suggestions, formatting, helpers |
| `templates` | project templates, scaffolded on the device |
| `formatter` | formatting on its own |
| `theme`, `icons` | how the editor looks |
| `app` | a screen of its own inside JCode |
| `dbmanager` | a database client |
| `scm` | source control |
| `vm` | virtual machine management |

A single extension often does several of these at once — a "dev pack" is usually a
`language` that also carries templates, run configurations and toolchain entries.

## Adding an extension

New to this? [**CREATING-EXTENSIONS.md**](CREATING-EXTENSIONS.md) walks through the
whole thing — what goes in the manifest, worked examples, icons, and how the app
installs the result. The short version:

1. **Make a repo** for the extension with an `extension.yaml` in its root. That one
   file is both the description the marketplace shows and the manifest JCode reads.
   `jext init` writes a starting point.
2. **Point this repo at it:**
   ```bash
   git submodule add -b main <repo-url> extensions/<name>
   ```
3. **Merge something there.** Its own workflow bumps the version, packs it, and
   publishes it to that repo's Releases.
4. **Run Sync dist_v2 here** (Actions → Sync dist_v2 → Run workflow). It signs
   anything newer than what `dist_v2/` holds and rebuilds the index. There is a
   dry-run option if you would rather see what it would pick up first.

Steps 1–3 can be repeated as often as you like without touching this repo. Step 4
is what actually publishes.

## Why signing happens here

A signature means *the marketplace maintainer looked at this and approved it*.

It matters because extensions are not sandboxed the way a web page is: an
extension can ship native code that runs inside JCode's own process, with JCode's
own permissions. So the app refuses to load that code unless the package carries a
marketplace signature.

The extension repos are public and their workflows only ever produce plain,
unsigned packages — which are perfectly usable as development sideloads. The key
that turns one into a published extension lives only in this repo, as the
`JCODE_SIGNING_KEY` secret, and only the sync workflow uses it.
