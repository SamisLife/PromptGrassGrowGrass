import type { Place } from '../types.js';

/**
 * The hackathon's fixed demo coordinate. It is not a real plot: it is a point on the floor of the
 * lower Yakima Valley, between Wapato and Zillah, chosen because the land around it is a true
 * patchwork (apples, hops, corn, alfalfa, grapes, cherries, mint, wheat, pears). The reasoning
 * and the candidates it beat are in docs/decisions.md. Its region data ships in region-data/.
 */
export const DEMO_PLACE: Place = { name: 'Lower Yakima Valley', region: 'Washington', country: 'United States', lat: 46.42, lon: -120.33 };
