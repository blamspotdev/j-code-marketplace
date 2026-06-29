# j-code-marketplace

Extension marketplace for JCode — language packs, templates, and (later)
theme / icon-set extensions.

Extension **sources** are git submodules under `extensions/`. Each is **compiled**
with [`jext`](https://github.com/blamspotdev/j-code-make-tools) into a `.jext`
package stored under `dist/`, and indexed by [`marketplace.yaml`](marketplace.yaml).
The JCode app reads the index to browse, then **downloads and verifies** the
chosen `.jext` to install it (it no longer clones repos on-device).

```
marketplace.yaml               # generated index: each entry -> dist/<id>-<ver>.jext + fingerprint
dist/                          # compiled .jext packages (what the app installs)
  jcode.lang.csharp-0.2.0.jext
  jcode.lang.javascript-0.1.0.jext
  jcode.lang.typescript-0.1.0.jext
  jcode.templates-0.2.1.jext
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
git clone --recurse-submodules https://github.com/janrick123/j-code-marketplace.git
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
3. Compile it into the registry:
   ```bash
   jext pack extensions/<name> -o dist/
   jext index .
   ```
4. Commit `dist/` + `marketplace.yaml` (+ the submodule) and push.
