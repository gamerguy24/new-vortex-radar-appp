#!/usr/bin/env node
/*
 * Cross-platform build for Vortex Radar.
 *
 * Replaces the old shell-based npm scripts, which broke under newer Node
 * versions because browserify's CLI sub-arg syntax (`-p [ glslify-require ]`)
 * fails to parse. This drives browserify through its JS API instead, so it
 * works the same on every platform and Node version.
 *
 *   node tools/build.js          -> bundle + minify + write size.txt
 *   node tools/build.js --watch  -> incremental rebundle on change (no minify)
 */

const fs = require('fs');
const path = require('path');
const browserify = require('browserify');
const UglifyJS = require('uglify-js');

const ROOT = path.join(__dirname, '..');
const ENTRY = path.join(ROOT, 'app/core/entry/entry.js');
const OUT = path.join(ROOT, 'dist/bundle.js');

// Second bundle: the Level 2 parser AND factory on their own, exposed as
// window.VortexL2, for pages that are not the radar page. The Graphics Studio
// uses it to decode the same AWS volume the radar page decodes, in the browser.
// It cannot use dist/bundle.js — that entry boots the whole application.
const L2_ENTRY = path.join(ROOT, 'app/radar/libnexrad/l2_browser_entry.js');
const L2_OUT = path.join(ROOT, 'dist/l2_bundle.js');

// level2_factory.js requires the radar page's UI at load time. Every one of
// these is used ONLY by plot(), display_file_info(), zoom_to_location() and the
// dealias paths — never by the accessors the studio calls (get_data,
// get_ranges, get_azimuth_angles, get_elevation_angle, get_location). Browserify
// replaces an ignored module with {}, so requiring them is harmless and calling
// them would throw loudly rather than silently misbehave.
//
// This mirrors the stub list in nws_radar_l2.js, which does the same thing to
// run this decoder under Node. Keep the two in step.
//
// Ignoring core/map/map also keeps mapbox-gl out of this bundle entirely.
const L2_IGNORE = [
    'app/radar/plot/plot_to_map.js',
    'app/radar/plot/calculate_coordinates.js',
    'app/core/map/map.js',
    'app/radar/libnexrad_helpers/display_file_info.js',
    'app/radar/libnexrad_helpers/level2/elevation_menu.js',
    'app/radar/libnexrad_helpers/level2/dealias/dealias.js',
].map((f) => path.join(ROOT, f));
const SIZE_FILE = path.join(__dirname, 'size.txt');

const watch = process.argv.includes('--watch') || process.argv.includes('-w');

function makeBundler(extraOpts) {
    return browserify(ENTRY, Object.assign({ basedir: ROOT }, extraOpts))
        .transform('brfs')
        .plugin('glslify-require');
}

function writeSizes() {
    const sizeOf = (f) => fs.statSync(f).size;
    const sizes = {
        'index.css': sizeOf(path.join(ROOT, 'index.css')),
        'bundle.js': sizeOf(OUT),
        'l2_bundle.js': sizeOf(L2_OUT),
    };
    fs.writeFileSync(SIZE_FILE, JSON.stringify(sizes, null, 0).replace(/,/g, ', ').replace(/:/g, ': ') + '\n');
    console.log('size.txt:', sizes);
}

function bundleToFile(bundler, outFile) {
    return new Promise((resolve, reject) => {
        const out = fs.createWriteStream(outFile || OUT);
        bundler.bundle()
            .on('error', reject)
            .pipe(out);
        out.on('finish', resolve);
        out.on('error', reject);
    });
}

async function build() {
    console.log('Bundling', path.relative(ROOT, ENTRY), '...');
    await bundleToFile(makeBundler());

    // Standalone Level 2 parser + factory bundle for the Graphics Studio.
    console.log('Bundling', path.relative(ROOT, L2_ENTRY), '-> window.VortexL2 ...');
    const l2 = browserify(L2_ENTRY, { basedir: ROOT, standalone: 'VortexL2' }).transform('brfs');
    L2_IGNORE.forEach((f) => l2.ignore(f));
    await bundleToFile(l2, L2_OUT);

    console.log('Minifying', path.relative(ROOT, OUT), '...');
    const code = fs.readFileSync(OUT, 'utf8');
    const result = UglifyJS.minify(code, { mangle: true });
    if (result.error) { throw result.error; }
    fs.writeFileSync(OUT, result.code);

    writeSizes();
    console.log('Build complete:', (fs.statSync(OUT).size / 1024 / 1024).toFixed(2), 'MB');
}

function startWatch() {
    const watchify = require('watchify');
    const bundler = makeBundler({ cache: {}, packageCache: {} }).plugin(watchify);

    async function rebundle() {
        const start = Date.now();
        try {
            await bundleToFile(bundler);
            writeSizes(); // unminified during watch, for a fast dev loop
            console.log(`Rebundled in ${Date.now() - start}ms`);
        } catch (err) {
            console.error('Bundle error:', err.message || err);
        }
    }

    bundler.on('update', rebundle);
    rebundle();
    console.log('Watching for changes...');
}

if (watch) {
    startWatch();
} else {
    build().catch((err) => {
        console.error('Build failed:', err && (err.message || err));
        process.exit(1);
    });
}
