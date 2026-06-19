/*
 * parse/level2/src/index.js
 * Provides the Level2Radar parser used by the 3D storm worker. We re-export it
 * from the published `nexrad-level-2-data` package via esm.sh (served as a
 * browser ES module with Node built-ins shimmed), so it works inside the
 * module worker without a build step.
 */

export { Level2Radar } from 'https://esm.sh/nexrad-level-2-data@1.5.2';
