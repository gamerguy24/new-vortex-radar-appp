/*
 * backend/graphics/radar_render_isolated.js
 * Runs a radar render in a child process, one at a time.
 *
 * Two protections, both learned from this failing in production:
 *
 * 1. ISOLATION. A Level 2 decode costs ~620 MB RSS. In-process, that spike is
 *    the web server's spike, and a modest box gets OOM-killed — which surfaces
 *    as a proxy 502 rather than an error from the endpoint. In a child, the
 *    memory is returned to the OS the moment it exits.
 *
 * 2. SERIALISATION. Two concurrent decodes would peak at over a gigabyte
 *    together, so renders are queued and run strictly one at a time. Requests
 *    for the SAME thing while one is in flight share its result instead of
 *    starting a second decode — a studio that re-requests while panning must
 *    not multiply the cost.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { execFile } = require('child_process');

const WORKER = path.join(__dirname, 'radar_render_worker.js');

// Cap the child's heap so a pathological volume fails cleanly in the child
// instead of dragging the machine down. Comfortably above a normal decode.
const CHILD_MAX_OLD_SPACE_MB = 1024;
const DEFAULT_TIMEOUT_MS = 90000;

let chain = Promise.resolve();     // serialises renders
const inflight = new Map();        // signature -> promise (shared result)

function runWorker(opts, timeoutMs) {
  return new Promise((resolve, reject) => {
    const out = path.join(os.tmpdir(), `vortex-radar-${crypto.randomBytes(8).toString('hex')}.png`);
    const payload = JSON.stringify({ ...opts, out });

    execFile(
      process.execPath,
      [`--max-old-space-size=${CHILD_MAX_OLD_SPACE_MB}`, WORKER, payload],
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        const cleanup = () => { try { fs.unlinkSync(out); } catch (e) { /* already gone */ } };
        if (err) {
          cleanup();
          const why = (stderr && String(stderr).trim()) || err.message;
          reject(new Error(err.killed ? `render timed out after ${timeoutMs}ms` : why));
          return;
        }
        let buffer;
        try {
          buffer = fs.readFileSync(out);
        } catch (e) {
          cleanup();
          reject(new Error('worker produced no image'));
          return;
        }
        cleanup();
        let meta = null;
        try { meta = JSON.parse(String(stdout)); } catch (e) { meta = null; }
        resolve({ buffer, meta });
      },
    );
  });
}

/**
 * Render a radar PNG out-of-process. Same options as renderRadarPng().
 * @returns {Promise<{buffer:Buffer, meta:object}>}
 */
function renderIsolated(opts, { timeoutMs = DEFAULT_TIMEOUT_MS, signature = null } = {}) {
  // Share an identical in-flight render rather than decoding twice.
  if (signature && inflight.has(signature)) return inflight.get(signature);

  const run = chain.then(() => runWorker(opts, timeoutMs));
  // Keep the queue alive even when a render fails.
  chain = run.catch(() => {});

  if (signature) {
    inflight.set(signature, run);
    run.finally(() => inflight.delete(signature));
  }
  return run;
}

module.exports = { renderIsolated };
