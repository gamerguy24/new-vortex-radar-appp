/*
 * backend/tornado/environment.js
 * Near-storm environment — from Vortex Radar's OWN weather data.
 *
 * This deliberately uses the same NOAA model GRIB2 pipeline that already powers
 * the app's Models browser and Skew-T soundings (model_data.js → HRRR/NAM/GFS
 * on the public NOAA S3 buckets, sampled by soundings_grib.js). No third-party
 * weather API is involved.
 *
 * Two reasons that matters beyond taste:
 *   - The CAPE the tornado engine scores with is the same CAPE a user sees when
 *     they click a sounding in the app. One source, one answer, no explaining
 *     why two numbers disagree.
 *   - It is already free, already cached, already proven on this deployment.
 *
 * Model preference is HRRR first (3 km, hourly, built for storm-scale work),
 * then NAM, then GFS. Whichever run is newest and complete wins.
 *
 * Everything here is BEST-EFFORT. If GRIB is unavailable, unsupported-packing,
 * or slow, get() returns null and the scorer redistributes the environmental
 * weight across the radar terms. The engine never stops for missing data.
 */

const path = require('path');
const log = require('./logger');

// The app's existing model + sounding infrastructure.
const modelData = require('../../model_data');
const { buildSounding } = require('../../soundings_grib');

const MODEL_ORDER = ['hrrr', 'nam', 'gfs'];

const cache = new Map();      // "lat,lon" -> { at, data|null }
const runCache = new Map();   // modelId  -> { at, run, messages, fileUrl }
let inflightRun = null;

function keyFor(lat, lon) {
    // 0.25° buckets — finer than the mesoscale environment varies, and it keeps
    // the number of GRIB point-samples per cycle small.
    return (Math.round(lat * 4) / 4).toFixed(2) + ',' + (Math.round(lon * 4) / 4).toFixed(2);
}

/** Wind (dir FROM, speed kt as the sounding reports) → u/v in m/s. */
function toUV(wdir, wspdKt) {
    if (!Number.isFinite(wdir) || !Number.isFinite(wspdKt)) return null;
    const ms = wspdKt * 0.514444;
    const r = wdir * Math.PI / 180;
    return { u: -ms * Math.sin(r), v: -ms * Math.cos(r) };
}

/** Build a bottom-up [{ zAgl, uv }] profile from the sounding levels. */
function windProfile(levels, surfaceZ) {
    const out = [];
    for (const l of levels || []) {
        if (l.z == null || l.wdir == null || l.wspd == null) continue;
        const uv = toUV(l.wdir, l.wspd);
        if (!uv) continue;
        out.push({ zAgl: Math.max(0, l.z - (surfaceZ || 0)), uv });
    }
    out.sort((a, b) => a.zAgl - b.zAgl);
    return out;
}

/** Bulk shear magnitude between the surface and `topM` AGL, m/s. */
function bulkShear(profile, topM) {
    if (!profile.length) return null;
    const base = profile[0];
    let top = null;
    for (const p of profile) { if (p.zAgl <= topM) top = p; else break; }
    // Prefer the first level at or above the layer top when one exists.
    const above = profile.find((p) => p.zAgl >= topM);
    const use = above || top;
    if (!use || use === base) return null;
    return Math.hypot(use.uv.u - base.uv.u, use.uv.v - base.uv.v);
}

/**
 * Storm-relative helicity against an ACTUAL storm motion vector.
 * SRH = Σ [ (u_{n+1} - c_u)(v_n - c_v) - (u_n - c_u)(v_{n+1} - c_v) ], m²/s².
 *
 * Using the radar-tracked motion of the specific cell is better than the usual
 * assumed/Bunkers motion: we already measured how this storm is moving.
 */
function computeSRH(profile, motionUV, topM) {
    if (!motionUV || profile.length < 2) return null;
    let srh = 0, used = 0;
    for (let i = 0; i < profile.length - 1; i++) {
        const lo = profile[i], hi = profile[i + 1];
        if (lo.zAgl > topM) break;
        const u1 = lo.uv.u - motionUV.u, v1 = lo.uv.v - motionUV.v;
        const u2 = hi.uv.u - motionUV.u, v2 = hi.uv.v - motionUV.v;
        srh += (u2 * v1) - (u1 * v2);
        used++;
    }
    return used ? srh : null;
}

/** Espy's rule LCL height, m AGL. */
function lclHeight(tC, tdC) {
    if (!Number.isFinite(tC) || !Number.isFinite(tdC)) return null;
    return Math.max(0, 125 * (tC - tdC));
}

/**
 * Resolve the newest usable model run and its message index.
 * Cached for an hour — a run does not change once published, and this is the
 * only part that costs a listing.
 */
async function currentRun(cfg) {
    const ttl = 60 * 60 * 1000;
    for (const id of MODEL_ORDER) {
        const hit = runCache.get(id);
        if (hit && Date.now() - hit.at < ttl && hit.messages) return hit;
    }
    if (inflightRun) return inflightRun;

    inflightRun = (async () => {
        for (const id of MODEL_ORDER) {
            const m = modelData.MODELS[id];
            if (!m || !m.file) continue;
            const product = m.soundingProduct || m.defaultProduct;
            try {
                const run = await modelData.latestRun(m, product);
                if (!run) continue;
                // Analysis hour (f00) is the closest thing to "now".
                const key = m.file(run.date, run.cycle, 0, product);
                const messages = await modelData.fetchIdx(m.bucket, key);
                if (!messages || !messages.length) continue;
                const entry = {
                    at: Date.now(),
                    model: id,
                    run,
                    messages,
                    fileUrl: modelData.s3KeyUrl(m.bucket, key),
                    header: { model: id, date: run.date, cycle: run.cycle, fhr: 0 },
                };
                runCache.set(id, entry);
                log.info('environment.run', { model: id, date: run.date, cycle: run.cycle, messages: messages.length });
                return entry;
            } catch (e) {
                log.warn('environment.runFailed', { model: id, err: e.message });
            }
        }
        return null;
    })().finally(() => { inflightRun = null; });

    return inflightRun;
}

/**
 * Environment near a point. Never throws; returns null when unavailable.
 * @param {object} stormMotion { direction, speedKmh } from radar tracking
 */
async function get(lat, lon, cfg, stormMotion) {
    if (!cfg.environment.enabled) return null;
    const key = keyFor(lat, lon);
    const ttl = cfg.environment.cacheMinutes * 60000;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return decorate(hit.data, stormMotion);

    let data = null;
    try {
        const run = await currentRun(cfg);
        if (!run) throw new Error('no model run available');

        const snd = await withTimeout(
            buildSounding({ fileUrl: run.fileUrl, messages: run.messages, lat, lon, header: run.header }),
            cfg.environment.timeoutMs * 4,   // GRIB range-fetches are slower than a REST call
        );

        const sfc = (snd.levels || []).find((l) => l.type === 9) || (snd.levels || [])[0] || {};
        const profile = windProfile(snd.levels, snd.surfaceZ);

        data = {
            cape: snd.cape,
            cin: snd.cin,
            // srh03Model is the app's own sounding value (its own storm-motion
            // assumption); srh01/srh03 below are computed against this storm's
            // measured motion and are what the score uses.
            srh03Model: snd.helic,
            precipWaterMm: snd.pw != null ? snd.pw / 10 : null,
            temperatureC: sfc.t != null ? Number(sfc.t.toFixed(1)) : null,
            dewPointC: sfc.td != null ? Number(sfc.td.toFixed(1)) : null,
            surfaceWind: (sfc.wdir != null && sfc.wspd != null)
                ? { directionFrom: sfc.wdir, speedMs: Number((sfc.wspd * 0.514444).toFixed(1)) } : null,
            lclHeightM: roundInt(lclHeight(sfc.t, sfc.td)),
            shear01Ms: round1(bulkShear(profile, 1000)),
            shear03Ms: round1(bulkShear(profile, 3000)),
            shear06Ms: round1(bulkShear(profile, 6000)),
            _profile: profile,
            source: `${run.model.toUpperCase()} ${run.run.date} ${run.run.cycle}Z f00 (NOAA GRIB2, same data as the app's soundings)`,
            model: run.model,
            fetchedAt: new Date().toISOString(),
        };
        cache.set(key, { at: Date.now(), data });
        log.debug('environment.sampled', { key, model: run.model, cape: data.cape, cin: data.cin });
    } catch (e) {
        // Negative-cache briefly so one bad point does not retry every cycle.
        cache.set(key, { at: Date.now() - ttl * 0.5, data: null });
        log.warn('environment.failed', { key, err: e.message });
        return null;
    }
    return decorate(data, stormMotion);
}

function round1(x) { return Number.isFinite(x) ? Number(x.toFixed(1)) : null; }

function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout after ' + ms + 'ms')), ms)),
    ]);
}

// SRH depends on the storm's own motion, so it is derived per-storm at read
// time from the cached wind profile rather than stored with it.
function decorate(data, stormMotion) {
    if (!data) return null;
    const out = { ...data };
    const profile = data._profile || [];
    delete out._profile;

    if (stormMotion && Number.isFinite(stormMotion.speedKmh) && stormMotion.speedKmh > 0) {
        const ms = stormMotion.speedKmh / 3.6;
        const r = stormMotion.direction * Math.PI / 180;   // heading TO
        const c = { u: ms * Math.sin(r), v: ms * Math.cos(r) };
        out.srh01 = roundInt(computeSRH(profile, c, 1000));
        out.srh03 = roundInt(computeSRH(profile, c, 3000));
        out.srhBasis = 'radar-tracked storm motion';
    } else {
        out.srh01 = null;
        out.srh03 = data.srh03Model != null ? data.srh03Model : null;
        out.srhBasis = out.srh03 != null ? 'model sounding (no storm motion yet)' : null;
    }
    return out;
}

function roundInt(x) { return Number.isFinite(x) ? Math.round(x) : null; }

function clearCache() { cache.clear(); runCache.clear(); }

module.exports = { get, clearCache, computeSRH, bulkShear, windProfile, toUV, MODEL_ORDER };
