// Template registry. The studio loads this and builds its UI from the list.
import severeThreat from './severe-threat.js';
import outlook from './outlook.js';
import precipPanels from './precip-panels.js';
import iceAccum from './ice-accum.js';
import stateSpotlight from './state-spotlight.js';
import lowerThird from './lower-third.js';

export const TEMPLATES = [severeThreat, outlook, precipPanels, iceAccum, stateSpotlight, lowerThird];
export const TEMPLATE_BY_ID = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));
