// Template registry. The studio loads this and builds its UI from the list.
import severeThreat from './severe-threat.js?v=tpl1';
import outlook from './outlook.js?v=tpl1';
import precipPanels from './precip-panels.js?v=tpl1';
import iceAccum from './ice-accum.js?v=tpl1';
import stateSpotlight from './state-spotlight.js?v=tpl1';
import lowerThird from './lower-third.js?v=tpl1';
import radarForecast from './radar-forecast.js?v=tpl1';
import forecastModel from './forecast-model.js?v=tpl1';
import liveRadar from './live-radar.js?v=tpl1';

export const TEMPLATES = [severeThreat, outlook, precipPanels, iceAccum, stateSpotlight, lowerThird, radarForecast, forecastModel, liveRadar];
export const TEMPLATE_BY_ID = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));

// Live Radar's Play loop controls — re-exported so studio.js can wire the
// toolbar button without importing live-radar.js under a second URL (which
// would load it as a second module instance with its own, unsynced state).
export { togglePlayback, isPlaying, stopPlayback, goLive, isLive } from './live-radar.js?v=tpl1';
