#!/usr/bin/env node
/*
 * backend/graphics/radar_render_worker.js
 * Renders one radar PNG in a SHORT-LIVED CHILD PROCESS, then exits.
 *
 * WHY A SEPARATE PROCESS
 * Decoding a NEXRAD Level 2 volume costs ~620 MB of RSS (measured: 35 MB → 622
 * MB for a single KTLX volume). Doing that inside the web server means the
 * server's own footprint spikes by half a gigabyte every time someone renders a
 * graphic, and on a modest box the kernel eventually kills the process. To the
 * browser that arrives as a bare HTTP 502 from the proxy, and to the operator it
 * looks like "the radar worked for thirty seconds and then broke".
 *
 * Here the spike lives in a process that exits immediately afterwards, so the
 * OS reclaims all of it and the server's RSS never moves. The parent gets back
 * a PNG of a few hundred KB.
 *
 * Protocol (deliberately boring, so there is no binary framing to get wrong):
 *   argv[2] = JSON options, including `out` — a file path to write the PNG to
 *   stdout  = one line of JSON metadata on success
 *   exit 0  = success, non-zero = failure with the reason on stderr
 */

const fs = require('fs');

async function main() {
  let opts;
  try {
    opts = JSON.parse(process.argv[2] || '{}');
  } catch (e) {
    process.stderr.write('bad options JSON: ' + e.message);
    process.exit(2);
  }
  if (!opts.out) {
    process.stderr.write('no output path given');
    process.exit(2);
  }

  const { renderRadarPng } = require('./radar_l2_render');
  const result = await renderRadarPng(opts);
  if (!result) {
    process.stderr.write('no radar volume available for this view');
    process.exit(3);
  }

  fs.writeFileSync(opts.out, result.buffer);
  process.stdout.write(JSON.stringify(result.meta));
  // Exit explicitly: the decoder leaves timers/handles around, and we want the
  // memory returned to the OS now rather than whenever the loop drains.
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(String((e && e.message) || e));
  process.exit(1);
});
