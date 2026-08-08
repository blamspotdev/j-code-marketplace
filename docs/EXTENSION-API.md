# JCode Extension API (v1)

How an extension's web frontend (`type: app` / `type: dbmanager`, `entry.ui` in the `.jehm`) talks
to the JCode IDE and its Linux runtime. The page runs in an Android WebView with two host objects:

- **`window.JCodeNative`** — injected by JCode (the native side).
- **`window.JCode`** — defined by *your page* (the callback side; JCode calls into it).

There are two generations of this bridge. Both work today; new extensions should use the
**request envelope** and declare `api:` in `extension.yaml`.

---

## 1. The request envelope (API v1)

### Calling

```js
JCodeNative.request(reqId, envelopeJson)
```

- `reqId` — any unique string; echoed back with the reply.
- `envelopeJson` — `{"type": "<family>.<verb>", "payload": { ... }}`.

The reply arrives asynchronously as a call to **`window.JCode._onResult(reqId, jsonString)`**
where the JSON is either `{"ok": true, "data": { ... }}` or `{"ok": false, "error": "message"}`.

Boilerplate promise wrapper (copy into your page):

```js
window.JCode = (function () {
  const pending = {}; let seq = 0;
  return {
    request(type, payload) {
      return new Promise((resolve) => {
        const id = 'q' + (seq++);
        pending[id] = resolve;
        try { window.JCodeNative.request(id, JSON.stringify({ type, payload: payload || {} })); }
        catch (e) { delete pending[id]; resolve({ ok: false, error: 'bridge unavailable: ' + e }); }
      });
    },
    _onResult(id, payload) {
      const cb = pending[id]; if (!cb) return; delete pending[id];
      let r; try { r = JSON.parse(payload); } catch (e) { r = { ok: false, error: String(payload) }; }
      cb(r);
    },
    _onEvent(name, json) { /* host events, see §3 */ },
  };
})();
```

### Declaring the API in `extension.yaml`

```yaml
api:
  minApiVersion: 1        # lowest JCode API version the extension needs
  capabilities:           # route families the extension uses (see §2)
    - exec
    - fs
    - workbench
```

- `minApiVersion` is checked at request time: if the extension asks for a newer API than the app
  provides, every request fails with a clear error.
- **Capabilities are granted by default but user-revocable** per extension on the
  *Extension Permissions* page. A request into an undeclared or revoked family fails with
  `{"ok":false,"error":"capability '<family>' is not declared…"}`. Design your UI to degrade.

### Paths

All paths crossing the bridge use **runtime (guest) form**: `/workspace/<project>/…` for project
files (mapped to the device's shared storage), or absolute host paths. Relative paths resolve
against the currently open project.

---

## 2. Route reference (v1)

### `api.*` — always available, no capability needed

| type | payload | data |
|---|---|---|
| `api.hello` | `{}` | `{ "apiVersion": 1, "jcodeVersion": "1.0.0" }` |

Call `api.hello` first: it confirms the envelope bridge exists and tells you what you're running on.
On apps too old to have the envelope, `JCodeNative.request` is undefined — feature-detect and show
an "update JCode" notice.

### `exec.*` — capability `exec`

| type | payload | data |
|---|---|---|
| `exec.run` | `{ "command": "...", "timeoutMs": 60000, "workdir": "/workspace/x", "user": "root", "env": {"K":"V"} }` (only `command` required) | `{ "stdout", "stderr", "exitCode", "error"? }` |

Runs a shell command in the Linux runtime. Defaults: `user: root`, runtime workdir (`/workspace`),
60 s timeout. `exitCode` is `-1` when the process was killed/never returned; `error` is present only
for bridge-internal failures. **Commands run as root in the user's runtime — treat this power
accordingly** (see Trust model below).

### `fs.*` — capability `fs`

| type | payload | data |
|---|---|---|
| `fs.read` | `{ "path": "/workspace/proj/a.txt" }` | `{ "content": "..." }` (files ≤ 2 MB) |
| `fs.write` | `{ "path": "...", "content": "..." }` | `{}` (creates parent dirs) |
| `fs.list` | `{ "path": "/workspace/proj" }` | `{ "entries": [{ "name", "dir", "size" }] }` |

Host-native file access (faster and safer than shelling out for simple IO).

### `workbench.*` — capability `workbench`

| type | payload | data |
|---|---|---|
| `workbench.openFile` | `{ "path": "...", "line": 12, "column": 3 }` (line/column optional, 1-based) | `{}` — opens/focuses the file in the editor |
| `workbench.notify` | `{ "message": "..." }` | `{}` — transient IDE notice |
| `workbench.openUrl` | `{ "url": "http(s)://..." }` | `{}` — opens the device browser (user's preview-browser setting applies) |
| `workbench.activeFile` | `{}` | `{ "path", "name", "dirty" }` or `{}` when no file tab is focused |
| `workbench.projectInfo` | `{}` | `{ "name", "path", "workspace" }` (fields absent when nothing is open) |

---

## 3. Host events

JCode pushes events into the page by calling **`window.JCode._onEvent(name, jsonString)`** (define
it or the events are dropped silently):

| event | payload | when |
|---|---|---|
| `activeFile` | same shape as `workbench.activeFile` | the focused editor file changes (deduped) |

Two lifecycle rules:

1. **No replay.** Your WebView is destroyed whenever its tab is backgrounded and recreated on
   return. Events fired in between are lost — on page load, *pull* current state
   (`workbench.activeFile`) instead of waiting for a push.
2. Only the **visible** extension page receives events (JCode shows one extension app at a time).

---

## 4. The legacy bridge (v0)

Pre-envelope extensions use `JCodeNative.exec(reqId, command, timeoutMs)` answered via
`window.JCode._onExec(reqId, jsonString)` with `{stdout, stderr, exitCode, error?}`. It still works
unchanged (VM Manager and SQL Client ship on it), is not capability-gated, and always runs as root.
New extensions should prefer `exec.run`, which is the same operation inside the versioned,
capability-aware envelope — and gains `workdir`/`user`/`env` control.

---

## 5. Trust model (read this)

- Extension frontends load from `file://` inside the app and their runtime commands execute **as
  root** inside the user's Linux runtime. There is no sandbox between an extension and the
  runtime's filesystem.
- The user's protections are: install-time package verification (per-file SHA-256 + fingerprint
  against the marketplace index), `minJCodeVersion` gating, the activation modes, and per-capability
  revocation for API-v1 extensions.
- Declare the **narrowest** capability set that works. An extension that only renders docs needs no
  capabilities at all; a DB client needs `exec`; an agent UI wants `exec` + `workbench`.

## 6. Versioning rules

- The envelope and existing routes are stable within API v1: fields are only ever **added** to
  payloads/replies, never renamed or removed.
- New route families / verbs may appear without a version bump — probing an unknown type returns
  `{"ok":false,"error":"unknown request type: …"}`, which is safe to treat as "not supported here".
- Breaking changes bump `apiVersion` (reported by `api.hello`) and the app keeps serving v1 routes.

## 7. Worked example

The Source Control extension (`jcode.ext.gitscm`) is the reference consumer, and exercises most of
v1: `exec.run` for every git invocation, `workbench.projectInfo` / `workbench.workspaceFolders` to
find the repository, `workbench.openFile` and `workbench.openFolder` / `workbench.addFolder` for
navigation and clone destinations, `workbench.setExplorerDecorations` to push VCS badges into the
file tree, `workbench.openView` / `workbench.closeView` to move between its own screens,
`workbench.notify` for progress, and the `config` capability for its own settings. Source:
<https://github.com/blamspotdev/jcode-ext-git-scm> under `src/`.
