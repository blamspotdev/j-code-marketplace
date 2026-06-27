# j-code-marketplace

Extension marketplace for JCode — code (language packs), templates, and (later)
theme / icon-set extensions. Each extension is a **git submodule** under
`extensions/`, indexed by [`marketplace.yaml`](marketplace.yaml). The JCode app
reads the index to browse, then clones the chosen extension on-device to install
it.

```
marketplace.yaml               # registry: id, name, type, submodule path, repo url
extensions/
  template-1/    -> j-code-ext-template-1   (type: templates)
  csharp/        -> j-code-ext-csharp       (type: language)
  javascript/    -> j-code-ext-javascript   (type: language)
  typescript/    -> j-code-ext-typescript   (type: language)
```

## Clone

```bash
git clone --recurse-submodules https://github.com/janrick123/j-code-marketplace.git
# or, after a plain clone:
git submodule update --init --recursive
```

## Extension types

- **templates** — project templates scaffolded on-device (`extension.yaml` +
  `templates/<id>/template.yaml`).
- **language** — editor coding suggestions, a basic formatter, and helpers
  (`extension.yaml` with a `language:` block).

## Add an extension

1. Create a `j-code-ext-<name>` repo with an `extension.yaml` manifest.
2. `git submodule add -b main <repo-url> extensions/<name>`.
3. Add an entry to `marketplace.yaml`.
4. Commit and push.
