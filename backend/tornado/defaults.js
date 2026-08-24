/*
 * backend/tornado/defaults.js
 * The default Tornado Potential configuration, as pure data.
 *
 * This is split out of config.js on purpose: config.js reads and watches the
 * filesystem, which cannot run in a browser. The rotation detector runs in BOTH
 * places — on the server for the background engine, and in the browser against
 * the volume the user is currently viewing — so the thresholds it needs have to
 * live in a module with no Node dependencies. Browserify bundles this file into
 * the client; config.js layers the JSON file and env overrides on top for the
 * server. One set of numbers, two consumers.
 */

module.exports = {
    enabled: false,
    sites: [],
    autoSelectSites: { enabled: true, maxSites: 6, fromNwsWarnings: true, fromSavedLocations: true, extraSites: [] },
    scan: { pollSeconds: 60, siteTimeoutMs: 90000, maxConcurrentSites: 2, minVolumeAgeSeconds: 0, staleVolumeMinutes: 20 },
    weights: {
        coupletStrength: 0.30, shearIncrease: 0.20, lowLevelRotation: 0.15, rotationTightening: 0.10,
        stormStructure: 0.10, stormRelativeVelocity: 0.05, instability: 0.05, helicityShear: 0.05,
    },
    detection: {
        minRangeKm: 8, maxRangeKm: 230, minReflectivityDbz: 35, reflectivitySearchKm: 3,
        minDeltaVMs: 20, minRotationalVelocityMs: 10, maxCoupletDiameterKm: 12, minSupportingGates: 4,
        maxBeamHeightKmForLowLevel: 3.0, azimuthWindow: 4, gateWindow: 4, nyquistAliasFactor: 0.92,
        seedLags: [1, 3, 6],
    },
    storms: {
        cellReflectivityDbz: 40, gridKm: 2, minCellGates: 6, maxTrackDistanceKm: 20,
        maxCoastMinutes: 15, circulationAttachKm: 15, projectionMinutes: [15, 30, 45, 60],
    },
    environment: { enabled: true, provider: 'model-grib', cacheMinutes: 30, timeoutMs: 8000, maxPointsPerCycle: 4 },
    nws: { enabled: true, cacheSeconds: 60, timeoutMs: 8000 },
    alerts: { enabled: true, minScore: 60, minConfidence: 'MEDIUM', cooldownMinutes: 10, minScoreIncrease: 10, maxFeedLength: 200 },
    history: { enabled: true, maxFileMb: 64, retainDays: 90 },
    modifiers: { persistenceMaxBonus: 0.15, persistenceFullMinutes: 20, decayFactor: 0.55, aliasPenalty: 0.85, confidenceFloor: 0.45 },
    ml: { enabled: false, modelPath: '', blendWeight: 0 },
    logging: { level: 'info', logScans: true, logDetections: true },
};
