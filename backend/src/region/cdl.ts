/**
 * USDA NASS Cropland Data Layer (CDL): what grew on every 30 m pixel of US farmland.
 *
 * This file is the lookup side: CDL class code -> name, family, display colour, and (where one
 * exists) the matching crop in our own rules table. Names follow the official CDL legend.
 * The colours are ours: the official palette is built for maps, ours for land seen from above.
 */
export type Family =
  | 'grain' | 'oilseed' | 'hay' | 'orchard' | 'vineyard' | 'hops_herbs' | 'berries' | 'vegetables' | 'other_crop'
  | 'pasture' | 'fallow' | 'forest' | 'shrub' | 'wetland' | 'water' | 'developed' | 'barren' | 'nodata';

export interface CdlClass { code: number; name: string; family: Family; color: string; cropId?: string }

/** Families a farmer works. Everything else is drawn as land, never offered as a partner. */
export const FARMED: ReadonlySet<Family> = new Set(['grain', 'oilseed', 'hay', 'orchard', 'vineyard', 'hops_herbs', 'berries', 'vegetables', 'other_crop']);

export const FAMILY_LABEL: Record<Family, string> = {
  grain: 'Grain', oilseed: 'Oilseeds & beans', hay: 'Hay & alfalfa', orchard: 'Orchard', vineyard: 'Vineyard', hops_herbs: 'Hops & herbs',
  berries: 'Berries', vegetables: 'Vegetables', other_crop: 'Other crops', pasture: 'Pasture & grass', fallow: 'Fallow', forest: 'Forest',
  shrub: 'Shrubland', wetland: 'Wetland', water: 'Water', developed: 'Towns & roads', barren: 'Barren', nodata: 'No data',
};

const FAMILY_COLOR: Record<Family, string> = {
  grain: '#c9a84a', oilseed: '#8a9a48', hay: '#7ba863', orchard: '#b0564a', vineyard: '#73539a', hops_herbs: '#3f9a78', berries: '#b04a72',
  vegetables: '#5fae52', other_crop: '#9a9a62', pasture: '#566b4a', fallow: '#84735c', forest: '#2c4636', shrub: '#5f5f45', wetland: '#3c6464',
  water: '#2c5674', developed: '#4c4f54', barren: '#6f6a60', nodata: '#22262a',
};

type Row = [code: number, name: string, family: Family, color?: string, cropId?: string];
const ROWS: Row[] = [
  [1, 'Corn', 'grain', '#d2ad3e', 'corn'], [2, 'Cotton', 'other_crop', '#d8d2c4'], [3, 'Rice', 'grain', '#9cc3a4'], [4, 'Sorghum', 'grain', '#b8853f'],
  [5, 'Soybeans', 'oilseed', '#7d9a44', 'bean'], [6, 'Sunflower', 'oilseed', '#dcb332'], [10, 'Peanuts', 'oilseed'], [11, 'Tobacco', 'other_crop'],
  [12, 'Sweet Corn', 'vegetables', '#e0c25a', 'corn'], [13, 'Pop or Orn Corn', 'grain', undefined, 'corn'], [14, 'Mint', 'hops_herbs', '#52bda6', 'mint'],
  [21, 'Barley', 'grain', '#cdb886'], [22, 'Durum Wheat', 'grain', '#d9c27c'], [23, 'Spring Wheat', 'grain', '#dcc88a'], [24, 'Winter Wheat', 'grain', '#d6bd72'],
  [25, 'Other Small Grains', 'grain'], [26, 'Dbl Crop WinWht/Soybeans', 'grain'], [27, 'Rye', 'grain', '#bfae7a'], [28, 'Oats', 'grain', '#c8b98e'],
  [29, 'Millet', 'grain'], [30, 'Speltz', 'grain'], [31, 'Canola', 'oilseed', '#d6d05a'], [32, 'Flaxseed', 'oilseed'], [33, 'Safflower', 'oilseed'],
  [34, 'Rape Seed', 'oilseed'], [35, 'Mustard', 'oilseed'], [36, 'Alfalfa', 'hay', '#6fa55a'], [37, 'Other Hay/Non Alfalfa', 'hay', '#8fae74'],
  [38, 'Camelina', 'oilseed'], [39, 'Buckwheat', 'grain'], [41, 'Sugarbeets', 'vegetables', '#a0567a', 'beet'], [42, 'Dry Beans', 'oilseed', '#9a7a52', 'bean'],
  [43, 'Potatoes', 'vegetables', '#a88d68', 'potato'], [44, 'Other Crops', 'other_crop'], [45, 'Sugarcane', 'other_crop'], [46, 'Sweet Potatoes', 'vegetables', '#c07a4a', 'sweet_potato'],
  [47, 'Misc Vegs & Fruits', 'vegetables'], [48, 'Watermelons', 'vegetables', '#6fb07a', 'melon'], [49, 'Onions', 'vegetables', '#bda2c6', 'onion'],
  [50, 'Cucumbers', 'vegetables', undefined, 'cucumber'], [51, 'Chick Peas', 'oilseed'], [52, 'Lentils', 'oilseed'], [53, 'Peas', 'vegetables', '#86c070', 'pea'],
  [54, 'Tomatoes', 'vegetables', '#c9503e', 'tomato'], [55, 'Caneberries', 'berries'], [56, 'Hops', 'hops_herbs', '#2f8f6c'], [57, 'Herbs', 'hops_herbs', '#5aa88c', 'basil'],
  [58, 'Clover/Wildflowers', 'hay', '#9ab87a', 'clover'], [59, 'Sod/Grass Seed', 'hay', '#7fb27a'], [60, 'Switchgrass', 'hay'], [61, 'Fallow/Idle Cropland', 'fallow'],
  [63, 'Forest', 'forest'], [64, 'Shrubland', 'shrub'], [65, 'Barren', 'barren'], [66, 'Cherries', 'orchard', '#93304c'], [67, 'Peaches', 'orchard', '#d88c5c'],
  [68, 'Apples', 'orchard', '#b9483e'], [69, 'Grapes', 'vineyard', '#73539a'], [70, 'Christmas Trees', 'orchard', '#3f6a4a'], [71, 'Other Tree Crops', 'orchard', '#8a6c3c'],
  [72, 'Citrus', 'orchard', '#dc943a'], [74, 'Pecans', 'orchard', '#80603c'], [75, 'Almonds', 'orchard', '#a5825a'], [76, 'Walnuts', 'orchard', '#7a5c3a'],
  [77, 'Pears', 'orchard', '#a9a348'], [81, 'Clouds/No Data', 'nodata'], [82, 'Developed', 'developed'], [83, 'Water', 'water'], [87, 'Wetlands', 'wetland'],
  [88, 'Nonag/Undefined', 'nodata'], [92, 'Aquaculture', 'water'], [111, 'Open Water', 'water'], [112, 'Perennial Ice/Snow', 'barren'],
  [121, 'Developed/Open Space', 'developed'], [122, 'Developed/Low Intensity', 'developed'], [123, 'Developed/Med Intensity', 'developed'], [124, 'Developed/High Intensity', 'developed'],
  [131, 'Barren', 'barren'], [141, 'Deciduous Forest', 'forest'], [142, 'Evergreen Forest', 'forest'], [143, 'Mixed Forest', 'forest'], [152, 'Shrubland', 'shrub'],
  [176, 'Grass/Pasture', 'pasture'], [190, 'Woody Wetlands', 'wetland'], [195, 'Herbaceous Wetlands', 'wetland'], [204, 'Pistachios', 'orchard', '#8f8a52'],
  [205, 'Triticale', 'grain'], [206, 'Carrots', 'vegetables', '#d9823a', 'carrot'], [207, 'Asparagus', 'vegetables', '#6f9f5a'], [208, 'Garlic', 'vegetables', '#d6cfc0', 'garlic'],
  [209, 'Cantaloupes', 'vegetables', undefined, 'melon'], [210, 'Prunes', 'orchard'], [211, 'Olives', 'orchard', '#6a7a4a'], [212, 'Oranges', 'orchard', '#dc943a'],
  [213, 'Honeydew Melons', 'vegetables', undefined, 'melon'], [214, 'Broccoli', 'vegetables', '#3f8a4a', 'kale'], [215, 'Avocados', 'orchard', '#4f6a3a'],
  [216, 'Peppers', 'vegetables', '#c2553a', 'pepper'], [217, 'Pomegranates', 'orchard'], [218, 'Nectarines', 'orchard'], [219, 'Greens', 'vegetables', '#6cc05a', 'spinach'],
  [220, 'Plums', 'orchard'], [221, 'Strawberries', 'berries', '#c6455c', 'strawberry'], [222, 'Squash', 'vegetables', '#c9b04a', 'squash'], [223, 'Apricots', 'orchard', '#dca05a'],
  [224, 'Vetch', 'hay'], [225, 'Dbl Crop WinWht/Corn', 'grain'], [226, 'Dbl Crop Oats/Corn', 'grain'], [227, 'Lettuce', 'vegetables', '#86cf6a', 'lettuce'],
  [228, 'Dbl Crop Triticale/Corn', 'grain'], [229, 'Pumpkins', 'vegetables', '#d98a3a', 'squash'], [230, 'Dbl Crop Lettuce/Durum Wht', 'vegetables'],
  [231, 'Dbl Crop Lettuce/Cantaloupe', 'vegetables'], [232, 'Dbl Crop Lettuce/Cotton', 'vegetables'], [233, 'Dbl Crop Lettuce/Barley', 'vegetables'],
  [234, 'Dbl Crop Durum Wht/Sorghum', 'grain'], [235, 'Dbl Crop Barley/Sorghum', 'grain'], [236, 'Dbl Crop WinWht/Sorghum', 'grain'], [237, 'Dbl Crop Barley/Corn', 'grain'],
  [238, 'Dbl Crop WinWht/Cotton', 'grain'], [239, 'Dbl Crop Soybeans/Cotton', 'oilseed'], [240, 'Dbl Crop Soybeans/Oats', 'oilseed'], [241, 'Dbl Crop Corn/Soybeans', 'grain'],
  [242, 'Blueberries', 'berries', '#4c5c9c', 'blueberry'], [243, 'Cabbage', 'vegetables', '#7fb08a', 'kale'], [244, 'Cauliflower', 'vegetables', '#cfd6c0', 'kale'],
  [245, 'Celery', 'vegetables', '#9fd07a', 'celery'], [246, 'Radishes', 'vegetables', '#c64a6a', 'radish'], [247, 'Turnips', 'vegetables', undefined, 'beet'],
  [248, 'Eggplants', 'vegetables', undefined, 'pepper'], [249, 'Gourds', 'vegetables', undefined, 'squash'], [250, 'Cranberries', 'berries', '#9c2f4a'],
  [254, 'Dbl Crop Barley/Soybeans', 'grain'],
];

const TABLE = new Map<number, CdlClass>(ROWS.map(([code, name, family, color, cropId]) => [code, { code, name, family, color: color ?? FAMILY_COLOR[family], ...(cropId ? { cropId } : {}) }]));

export function cdlClass(code: number): CdlClass {
  return TABLE.get(code) ?? { code, name: code === 0 ? 'No data' : `CDL class ${code}`, family: 'nodata', color: FAMILY_COLOR.nodata };
}
export const isFarmed = (code: number): boolean => FARMED.has(cdlClass(code).family);
/** Plain, lower-case crop word for a sentence: "Dbl Crop WinWht/Corn" is not something to say aloud. */
export function cropWord(code: number): string {
  const c = cdlClass(code);
  if (/^Dbl Crop/.test(c.name)) return 'double-cropped grain';
  return c.name.replace('Other Hay/Non Alfalfa', 'hay').replace('Sod/Grass Seed', 'grass seed').replace('Clover/Wildflowers', 'clover').replace('Misc Vegs & Fruits', 'mixed vegetables').toLowerCase();
}
