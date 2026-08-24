#!/usr/bin/env node
// Bring `dist_v2/` level with what the extension repos have released.
//
// Each extension repo packs a PLAIN `.jext` on every merge and attaches it to a Release. This walks
// that list, and wherever a repo has published a version newer than the one sitting in `dist_v2/`,
// downloads it, signs it with the marketplace key and replaces the old file. `jext index` then
// rewrites `marketplace_v2.yaml`, which is what the app actually reads.
//
// Signing is the whole point of the step: an unsigned release asset is a development sideload, and
// only a package signed with this key is one the app will load native code from.
//
// Run by .github/workflows/sync-dist-v2.yml on manual dispatch. Env:
//   GITHUB_TOKEN      read access for the releases API (higher rate limit; public repos otherwise)
//   SIGNING_KEY_FILE  keyfile jsign signs with (never printed, never committed)
//   ONLY              comma-separated repo names to consider; empty = every submodule
//   GITHUB_API        API root, for pointing the release lookup somewhere other than github.com
//   DRY_RUN           "true" to report what would change and touch nothing

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist_v2');
const INDEX = 'marketplace_v2.yaml';
const JEXT = process.env.JEXT_BIN || path.join(ROOT, '.jext-tools/bin/jext.js');
const JSIGN = process.env.JSIGN_BIN || path.join(ROOT, '.jsign-tools/bin/jsign.js');
const API = process.env.GITHUB_API || 'https://api.github.com';

/** Numeric version compare: -1 / 0 / 1. Shorter versions pad with zeros, so 1.2 == 1.2.0. */
export function compareVersions(a, b) {
  const pa = String(a).split('.');
  const pb = String(b).split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = Number(pa[i] ?? 0);
    const nb = Number(pb[i] ?? 0);
    if (Number.isNaN(na) || Number.isNaN(nb)) return String(a).localeCompare(String(b));
    if (na !== nb) return na < nb ? -1 : 1;
  }
  return 0;
}

/** `jcode.lang.python-0.2.4.jext` + version → `jcode.lang.python`. */
export function idFromAsset(assetName, version) {
  const base = assetName.replace(/\.jext$/i, '');
  const suffix = `-${version}`;
  return base.endsWith(suffix) ? base.slice(0, -suffix.length) : base;
}

/** The `owner/repo` of every submodule — the marketplace already tracks exactly the right list. */
export function reposFromGitmodules(text) {
  return [...text.matchAll(/^\s*url\s*=\s*(.+?)\s*$/gm)]
    .map((m) => m[1].replace(/^.*github\.com[/:]/, '').replace(/\.git$/, ''))
    .filter(Boolean);
}

/** What `dist_v2/` currently holds, keyed by extension id. */
export function packagesInDist(files) {
  const held = new Map();
  for (const file of files) {
    const m = /^(.+)-([0-9][0-9.]*)\.jext$/i.exec(file);
    if (m) held.set(m[1], { version: m[2], file });
  }
  return held;
}

function log(line) {
  process.stdout.write(`${line}\n`);
}

async function api(url, token, accept = 'application/vnd.github+json') {
  const res = await fetch(url, {
    headers: {
      accept,
      'user-agent': 'jcode-marketplace-sync',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res;
}

async function latestRelease(repo, token) {
  const res = await api(`${API}/repos/${repo}/releases/latest`, token);
  if (!res) return null; // no release yet, or every release is a draft/prerelease
  const body = await res.json();
  const asset = (body.assets || []).find((a) => a.name.toLowerCase().endsWith('.jext'));
  const version = String(body.tag_name || '').replace(/^v/, '');
  if (!asset || !version) return { repo, version, asset: null, tag: body.tag_name };
  return { repo, version, tag: body.tag_name, asset };
}

async function download(asset, token, into) {
  const res = await api(asset.url, token, 'application/octet-stream');
  if (!res) throw new Error(`asset ${asset.name} vanished`);
  const file = path.join(into, asset.name);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

async function main() {
  const token = process.env.GITHUB_TOKEN || '';
  const dryRun = process.env.DRY_RUN === 'true';
  const only = (process.env.ONLY || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const keyFile = process.env.SIGNING_KEY_FILE;
  if (!dryRun && !(keyFile && fs.existsSync(keyFile))) {
    throw new Error('SIGNING_KEY_FILE is unset or missing — nothing can be signed');
  }

  fs.mkdirSync(DIST, { recursive: true });
  const held = packagesInDist(fs.readdirSync(DIST));
  let repos = reposFromGitmodules(fs.readFileSync(path.join(ROOT, '.gitmodules'), 'utf8'));
  if (only.length) repos = repos.filter((r) => only.some((o) => r === o || r.endsWith(`/${o}`)));
  if (!repos.length) throw new Error('no extension repos to check — is .gitmodules empty?');

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'jext-'));
  const rows = [];
  let changed = 0;

  for (const repo of repos) {
    const release = await latestRelease(repo, token).catch((e) => ({ repo, error: e.message }));
    if (!release) {
      rows.push({ name: repo, detail: '—', state: 'no release yet' });
      continue;
    }
    if (release.error) {
      log(`::warning::${repo}: ${release.error}`);
      rows.push({ name: repo, detail: '—', state: 'lookup failed', note: release.error });
      continue;
    }
    if (!release.asset) {
      log(`::warning::${repo}: release ${release.tag} carries no .jext`);
      rows.push({ name: repo, detail: release.version, state: 'release has no .jext' });
      continue;
    }

    const id = idFromAsset(release.asset.name, release.version);
    const current = held.get(id);
    if (current && compareVersions(release.version, current.version) <= 0) {
      rows.push({ name: id, detail: current.version, state: 'up to date' });
      continue;
    }

    const from = current ? current.version : 'absent';
    if (dryRun) {
      rows.push({ name: id, detail: `${from} → ${release.version}`, state: 'would sign', note: repo, version: release.version });
      changed++;
      continue;
    }

    const plain = await download(release.asset, token, staging);
    // Signed into a scratch directory first: jsign names the file from the package's own metadata,
    // and only what actually lands there says which package this is. Deleting by a predicted name
    // would delete the file jsign had just written whenever the two disagreed.
    const sealed = fs.mkdtempSync(path.join(staging, 'sealed-'));
    execFileSync(process.execPath, [JSIGN, 'sign', plain, '-o', sealed, '--key', keyFile], {
      stdio: 'inherit',
    });
    const produced = fs.readdirSync(sealed).find((f) => f.toLowerCase().endsWith('.jext'));
    if (!produced) throw new Error(`${repo}: jsign wrote no package`);

    const sealedVersion = /-([0-9][0-9.]*)\.jext$/.exec(produced)?.[1];
    if (sealedVersion !== release.version) {
      // The tag and the manifest inside the package disagree. Publishing either one leaves the
      // marketplace claiming a version its own file contradicts, so this needs fixing upstream.
      log(`::warning::${repo}: release ${release.tag} carries ${produced} — tag and manifest disagree, skipping`);
      rows.push({ name: id, detail: `${release.version} vs ${sealedVersion}`, state: 'version mismatch', note: repo });
      continue;
    }

    for (const file of fs.readdirSync(DIST)) {
      if (file !== produced && file.startsWith(`${id}-`) && file.toLowerCase().endsWith('.jext')) {
        fs.unlinkSync(path.join(DIST, file));
      }
    }
    fs.copyFileSync(path.join(sealed, produced), path.join(DIST, produced));
    rows.push({ name: id, detail: `${from} → ${release.version}`, state: 'signed', note: repo, version: release.version });
    changed++;
  }

  fs.rmSync(staging, { recursive: true, force: true });

  if (changed && !dryRun) {
    execFileSync(process.execPath, [JEXT, 'index', ROOT, '--dist', 'dist_v2', '--out', INDEX], {
      stdio: 'inherit',
    });
  }

  const width = rows.reduce((w, r) => Math.max(w, r.name.length), 0);
  log('');
  for (const { name, detail, state, note } of rows) {
    log(`  ${name.padEnd(width)}  ${state.padEnd(16)} ${detail}${note ? `  (${note})` : ''}`);
  }
  log('');
  log(changed ? `${changed} package(s) ${dryRun ? 'would be' : ''} signed into dist_v2/.` : 'dist_v2/ is already current.');

  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = [
      `### dist_v2 sync${dryRun ? ' (dry run)' : ''}`,
      '',
      '| extension | version | outcome |',
      '| --- | --- | --- |',
      ...rows.map((r) => `| \`${r.name}\` | ${r.detail} | ${r.state} |`),
    ].join('\n');
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
  }
  if (process.env.GITHUB_OUTPUT) {
    // Named here so the commit the workflow makes says which packages it carries.
    const signed = rows
      .filter((r) => r.state === 'signed')
      .map((r) => `${r.name}@${r.version}`)
      .join(', ');
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\nsigned=${signed}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    log(`::error::${err.message}`);
    process.exit(1);
  });
}
