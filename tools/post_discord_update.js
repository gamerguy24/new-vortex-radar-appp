#!/usr/bin/env node
/*
 * tools/post_discord_update.js — post an update to the development Discord.
 *
 *   node tools/post_discord_update.js                 # the last commit
 *   node tools/post_discord_update.js --count 5       # the last 5 commits
 *   node tools/post_discord_update.js --range main@{1}..main
 *   node tools/post_discord_update.js --message "Deployed to the server"
 *   node tools/post_discord_update.js --changelog     # the newest What's New
 *   node tools/post_discord_update.js --changelog 3   # the newest 3 releases
 *   node tools/post_discord_update.js --test
 *
 * --changelog posts what USERS are told, which is not the same thing as a list
 * of commit subjects: it reads app/core/changelog/changelog.js — the same
 * What's New the app shows — and posts one embed per release.
 *
 * The webhook URL comes from DISCORD_WEBHOOK_URL (environment, or the app's
 * .env). It is a password — anyone holding it can post to the channel — so it
 * lives in .env, which is gitignored, and never in the repo.
 *
 * The GitHub Action (.github/workflows/discord-updates.yml) is what posts on
 * every push. This script is for posting by hand, or from a deploy script on
 * the server, where there is no GitHub event to hang off.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

function webhookUrl() {
  if (process.env.DISCORD_WEBHOOK_URL) return process.env.DISCORD_WEBHOOK_URL.trim();
  try {
    const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    const m = env.match(/^DISCORD_WEBHOOK_URL\s*=\s*(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  } catch (e) { /* no .env */ }
  return null;
}

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim();
}

function commits() {
  const range = arg('range', null);
  const count = parseInt(arg('count', '1'), 10) || 1;
  const args = ['log', '--no-merges', '--pretty=format:%h\u001f%s\u001f%an'];
  if (range) args.push(range); else args.push('-n', String(count));
  const out = git(args);
  if (!out) return [];
  return out.split('\n').map((line) => {
    const [sha, subject, author] = line.split('\u001f');
    return { sha, subject, author };
  });
}

/*
 * Read the What's New releases out of changelog.js.
 *
 * Parsed rather than require()d: changelog.js pulls in the app's dialog module,
 * which expects a browser. The shape it is parsed from is the shape the file
 * has had throughout — a date followed by { title, desc } items.
 */
function releases(limit, skip) {
  const src = fs.readFileSync(path.join(ROOT, 'app/core/changelog/changelog.js'), 'utf8');
  const blockRe = /date:\s*'([^']+)',\s*\r?\n\s*items:\s*\[([\s\S]*?)\r?\n\s{8}\],/g;
  const itemRe = /\{\s*title:\s*'((?:[^'\\]|\\.)*)',\s*desc:\s*'((?:[^'\\]|\\.)*)'/g;
  const unescape = (s) => s.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  const all = [];
  for (const b of src.matchAll(blockRe)) {
    const items = [...b[2].matchAll(itemRe)].map((m) => ({ title: unescape(m[1]), desc: unescape(m[2]) }));
    if (items.length) all.push({ date: b[1], items });
    if (all.length >= limit + skip) break;
  }
  // --skip exists to post a BACKLOG without repeating a release the automatic
  // push notification has already sent.
  return all.slice(skip, skip + limit);
}

function repoUrl() {
  try {
    const remote = git(['remote', 'get-url', 'origin']);
    return remote.replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/');
  } catch (e) { return null; }
}

async function main() {
  const url = webhookUrl();
  if (!url) {
    console.error('DISCORD_WEBHOOK_URL is not set.\n'
      + 'Add it to .env (which is gitignored):\n'
      + '  DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...');
    process.exit(1);
  }

  const message = arg('message', null);
  const isTest = process.argv.includes('--test');
  const base = repoUrl();
  let embed;

  // What's New, exactly as users see it: one embed per release, newest first.
  if (process.argv.includes('--changelog')) {
    const n = parseInt(arg('changelog', '1'), 10) || 1;
    const skip = parseInt(arg('skip', '0'), 10) || 0;
    const blocks = releases(Math.min(n, 8), skip);
    if (!blocks.length) { console.error('no releases found in changelog.js'); process.exit(1); }
    const embeds = blocks.map((b) => ({
      title: "What's New — " + b.date,
      // Discord caps a description at 4096; a release of long notes is trimmed
      // rather than rejected outright.
      description: b.items.map((i) => '**' + i.title + '**\n' + i.desc).join('\n\n').slice(0, 4000),
      color: 0x27beff,
    }));
    // --dry prints what would be sent. Worth having: a malformed parse is much
    // cheaper to see here than in the channel.
    if (process.argv.includes('--dry')) {
      for (const e of embeds) console.log('\n=== ' + e.title + ' ===\n' + e.description);
      console.log('\n(dry run — nothing posted; ' + embeds.length + ' embed(s))');
      return;
    }
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Echo Radar', embeds }),
    });
    if (!r.ok) { console.error('Discord replied ' + r.status + ': ' + (await r.text()).slice(0, 300)); process.exit(1); }
    console.log('posted ' + embeds.length + " release(s) of What's New to Discord.");
    return;
  }

  if (isTest) {
    embed = {
      title: 'Webhook connected',
      description: 'Echo Radar will post here whenever an update is pushed.',
      color: 0x27beff,
      timestamp: new Date().toISOString(),
    };
  } else if (message) {
    embed = { title: 'Echo Radar', description: message, color: 0x27beff, timestamp: new Date().toISOString() };
  } else {
    const list = commits();
    if (!list.length) { console.error('no commits found'); process.exit(1); }
    embed = {
      title: `${list.length} commit${list.length === 1 ? '' : 's'}`,
      description: list.map((c) => (base ? `[\`${c.sha}\`](${base}/commit/${c.sha}) ` : `\`${c.sha}\` `)
        + c.subject.slice(0, 140) + ' — ' + c.author).join('\n').slice(0, 3900),
      color: 0x27beff,
      timestamp: new Date().toISOString(),
    };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'Echo Radar', embeds: [embed] }),
  });
  if (!res.ok) {
    console.error('Discord replied ' + res.status + ': ' + (await res.text()).slice(0, 300));
    process.exit(1);
  }
  console.log('posted to Discord.');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
