# Creating a JCode extension

A JCode extension is two text files — a **header** (`extension.jehm`) and a
**functional manifest** (`extension.yaml`) — plus optional `media/` and
`templates/`. The [`jext`](https://github.com/blamspotdev/j-code-make-tools) tool
compiles that folder into a single **`.jext`** package (a zip, like a VS Code
`.vsix`). The JCode app installs **only** verified `.jext` packages listed in this
repo's [`marketplace.yaml`](marketplace.yaml).

## The flow at a glance

```
  your extension folder                jext pack            jext index           git push
  extension.jehm  (metadata)     ┌──►  dist/<id>-<ver>.jext  ──►  marketplace.yaml  ──►  GitHub
  extension.yaml  (behavior)  ───┤     dist/icons/<id>.png                                  │
  media/  templates/             └──────────────────────────────────────────────────┐     │
                                                                                      ▼     ▼
                                          JCode app:  Extensions ▸ Refresh ▸ Install
                                          ↳ downloads the .jext, verifies its fingerprint
                                            + minJCodeVersion, extracts, and registers it.
```

```bash
jext init my-ext --type language        # scaffold extension.jehm + extension.yaml + media/
#   …edit the two files, drop in media/icon.png…
jext validate my-ext                    # sanity-check the header + manifest
jext pack my-ext -o dist/               # compile → dist/<uniqueName>-<version>.jext
jext index .                            # regenerate marketplace.yaml (run in THIS repo)
git add dist/ marketplace.yaml && git commit -m "Add my-ext" && git push
#   …in JCode: Extensions ▸ Refresh ▸ open the extension ▸ Install.
```

---

## 1. Prerequisites — the make-tools CLI

You need [Node.js](https://nodejs.org) and the `jext` CLI:

```bash
git clone https://github.com/blamspotdev/j-code-make-tools.git
cd j-code-make-tools && npm install
npm link            # makes `jext` available on your PATH
#   …or skip the link and call it as `node /path/to/j-code-make-tools/bin/jext.js …`
```

Commands: `jext init | validate | pack | index | help`.

## 2. Scaffold

```bash
jext init my-lang --type language --name "My Language Pack" \
  --id jcode.lang.mylang --publisher you
```

Types: `language`, `templates`, `formatter`, `theme`, `icons`
(`language` and `templates` are functional today; the rest are reserved).
`init` writes `extension.jehm`, an `extension.yaml` stub, an empty `media/`, and a
`README.md`.

## 3. The header — `extension.jehm`

YAML frontmatter (metadata) + a Markdown body (the long description shown on the
detail page). Full field reference: the
[JEHM spec](https://github.com/blamspotdev/j-code-make-tools/blob/main/docs/JEHM-SPEC.md).

```markdown
---
schema: 1
uniqueName: jcode.lang.mylang        # globally-unique reverse-DNS id; the install id
name: My Language Pack
version: 1.0.0                        # YOUR extension's own version (semver)
type: language
publisher: you
shortDescription: Coding suggestions, a basic formatter, and helpers for MyLang.
minJCodeVersion: 1.0.0               # lowest JCode app version that can run this
targetJCodeVersion: 1.0.0           # version you built/tested against
category: Languages
subcategory: MyLang
requires:                            # shown in a pre-install prompt (advisory — install still proceeds)
  sdks: []                           #   SDK ids (install via the SDK Manager)
  lsps: []                           #   language-server ids (install via the LSP Manager)
  extensions: []                     #   other extension uniqueNames
suggests:                            # soft recommendations (same prompt)
  sdks: [nodejs]
  lsps: []
  extensions: []
images:
  icon: media/icon.png               # see §6
  samples: []
  walkthrough: []
entry:
  manifest: extension.yaml           # the functional manifest below
  ui: null                           # reserved (extensions with their own UI)
  libs: []                           # reserved
fingerprint: { algo: sha256, value: null }   # reserved; integrity lives in .jext-manifest.json
---

# My Language Pack

The Markdown body is the long description. Reference screenshots from `media/`:
<!-- ![Sample](media/sample-1.png) -->
```

## 4. The functional manifest — `extension.yaml`

This is where the extension actually *does* something. Shape depends on `type`.

### `type: language`

Drives file association, syntax coloring, as-you-type completions, snippet
helpers, and the built-in formatter.

```yaml
id: jcode.lang.mylang
name: My Language Pack
version: 1.0.0
type: language
language:
  id: mylang
  extensions: [".ml", ".mylang"]          # file globs → which files this pack handles
  comment:
    line: "//"
    blockStart: "/*"
    blockEnd: "*/"
  strings: ["\"", "'", "`"]                # string delimiters (backtick = multi-line)
  keywords: [let, fn, if, else, return]    # colored as keywords
  types: [Int, String, Bool]               # colored as types
  formatter:
    indent: 2                              # ← built-in "Format Document" uses these three
    trimTrailingWhitespace: true
    insertFinalNewline: true
    command: "prettier --write {{file}}"   # external formatter — PARSED, not yet executed
  completions:                             # as-you-type popup items
    - label: fn
      detail: function
      insert: "fn $1($2) {\n  $0\n}"        # LSP snippet syntax (see note)
  helpers:                                 # named snippets, also surfaced in the popup
    - title: Print line
      snippet: "println($1);"
```

**Snippet syntax** (`insert` / `snippet`): `$1`, `$2`, … are tab stops, `$0` is the
final caret, `${1:placeholder}` seeds default text. On accept, JCode expands the
snippet and places the caret at the first stop.

**What's wired today:** highlighting, language detection, completions, helpers, and
the built-in **Format Document** (`indent` / `trimTrailingWhitespace` /
`insertFinalNewline`). The external `formatter.command` is read but not yet run.

### `type: templates`

Project templates scaffolded on-device. `extension.yaml` lists template ids; each
id has a `templates/<id>/template.yaml` recipe.

```yaml
# extension.yaml
id: jcode.templates.mine
name: My Templates
version: 1.0.0
type: templates
templates: [react-app, empty]              # → templates/react-app/, templates/empty/
```

```yaml
# templates/react-app/template.yaml
id: react-app
name: React App
description: A React single-page app scaffolded with Vite.
requires: [nodejs]                         # SDK ids the recipe needs
recipe:                                     # ordered bash steps run in the runtime
  - label: Scaffold React (Vite) app
    workdir: "{{hostStaging}}"
    run: CI=1 npm create vite@latest app -- --template react </dev/null
  - label: Copy app source into project
    run: cd "{{hostStaging}}/app" && tar --exclude=node_modules -cf - . | (cd "{{projectDir}}" && tar -xf -)
  - label: Configure Build & Run
    run: |
      mkdir -p "{{projectDir}}/.jcode"
      cat > "{{projectDir}}/.jcode/run.yaml" <<'YAML'
      version: 1
      name: Vite / React dev server
      readyPort: 5173
      terminals:
        - { label: Client, command: "cd \"{{projectDir}}\" && npm install && npm run dev -- --host 0.0.0.0 --port 5173" }
      YAML
```

The scaffolder substitutes `{{projectDir}}` (the new project's path),
`{{hostStaging}}` (a scratch dir), and `{{name}}`. Writing a `.jcode/run.yaml`
(last step above) makes the project's **Build & Run** work immediately.

## 5. Validate

```bash
jext validate my-lang        # checks required header fields, type, manifest presence
```

## 6. Icon & images

Put a square PNG at `media/icon.png` (≈256–512 px) and point the header at it:
`images.icon: media/icon.png`. `jext pack` bundles `media/`; `jext index` also
copies the icon out to `dist/icons/<uniqueName>.png` so the marketplace can show it
**before** install. Once installed, the app reads the icon from the extracted
package. No icon? JCode shows a type-tinted monogram fallback.

## 7. Pack & index

```bash
jext pack my-lang -o dist/   # → dist/<uniqueName>-<version>.jext (+ a .jext-manifest.json inside)
jext index .                 # regenerate marketplace.yaml from every dist/*.jext
```

`pack` records a per-file SHA-256 and an order-independent package **fingerprint**
in `.jext-manifest.json`; `index` copies each entry's fields (incl. `publisher` and
`icon`) into `marketplace.yaml`. See the
[JEXT spec](https://github.com/blamspotdev/j-code-make-tools/blob/main/docs/JEXT-SPEC.md).

## 8. Publish

If the extension source lives in its own repo, add it as a submodule first
(`git submodule add -b main <repo-url> extensions/<name>`). Then commit and push
the build artifacts from **this** repo:

```bash
git add dist/ marketplace.yaml          # + the submodule, if you added one
git commit -m "Add <uniqueName> <version>"
git push
```

The app fetches the index from
`raw.githubusercontent.com/blamspotdev/j-code-marketplace/main/marketplace.yaml`, so
it's live as soon as the push propagates.

## 9. Install & test in JCode

Open the **Extensions** tab in the left drawer → **Refresh** → tap your extension →
**Install**. On install the app:

1. downloads `dist/<uniqueName>-<version>.jext`,
2. recomputes every file's SHA-256 and the package fingerprint, rejecting any
   mismatch (corruption / tamper),
3. rejects it if `minJCodeVersion` is newer than the running app
   (the app's version comes from its `VERSION.txt`, currently `1.0.0`),
4. extracts it under `filesDir/extensions/<uniqueName>/` and activates it.

## Versioning & compatibility

- **`version`** — your extension's own semver. Bump it on every release; the
  `.jext` filename and the index entry both carry it, and the app uses it to detect
  updates against an installed copy.
- **`minJCodeVersion` / `targetJCodeVersion`** — JCode app compatibility, not your
  version. Set `minJCodeVersion` to the oldest app you've verified.

## Licensing your extension

Your extension is **your** work. You keep the copyright and may license it however
you like — **open-source or proprietary/closed-source, free or paid**. Listing an
extension in the JCode marketplace does **not** require it to be open-source, the
same way a Visual Studio Code extension can be closed-source.

- This marketplace's own code and docs, and the first-party example extensions, are
  MIT-licensed. That license covers the registry and tooling — **not** the extensions
  you publish through it.
- Using JCode's `.jext` extension API does not make your extension a derivative work
  of the JCode app, so the app's license does not extend to your extension.
- Put your chosen license in your extension's own repo, and reference it from the
  extension's `README` or `.jehm` long description if you like.

## Reference

- [JEHM spec](https://github.com/blamspotdev/j-code-make-tools/blob/main/docs/JEHM-SPEC.md) — header fields.
- [JEXT spec](https://github.com/blamspotdev/j-code-make-tools/blob/main/docs/JEXT-SPEC.md) — package format + install/verify flow.
- This repo's [`extensions/`](extensions) submodules — real, working examples
  (`javascript`, `typescript`, `csharp` = `language`; `template-1` = `templates`).
