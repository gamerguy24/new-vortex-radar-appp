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
    };
    fs.writeFileSync(SIZE_FILE, JSON.stringify(sizes, null, 0).replace(/,/g, ', ').replace(/:/g, ': ') + '\n');
    console.log('size.txt:', sizes);
}

function bundleToFile(bundler) {
    return new Promise((resolve, reject) => {
        const out = fs.createWriteStream(OUT);
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
