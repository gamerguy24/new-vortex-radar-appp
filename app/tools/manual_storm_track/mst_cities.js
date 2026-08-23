/*
 * mst_cities.js
 * Population-aware place database for the Manual Storm Track tool's "Impact
 * Times" panel. Each record is [name, lat, lon, population].
 *
 * Source priority:
 *   1. window.vortexData.mstCities, if an app supplies its own array.
 *   2. ./mst_cities_data.js — ~17k US populated places (pop >= 1000) generated
 *      from GeoNames (CC-BY 4.0). This is the normal path.
 *   3. The small CURATED list below, only as a fallback if (2) is missing.
 *
 * Regenerate mst_cities_data.js from GeoNames cities1000.txt: keep rows where
 * country code == 'US' and feature class == 'P', emit [asciiname, lat, lon, pop].
 */

// [name, lat, lon, population]
const CURATED = [
    ['New York', 40.71, -74.01, 8336817], ['Los Angeles', 34.05, -118.24, 3898747],
    ['Chicago', 41.88, -87.63, 2746388], ['Houston', 29.76, -95.37, 2304580],
    ['Phoenix', 33.45, -112.07, 1608139], ['Philadelphia', 39.95, -75.17, 1603797],
    ['San Antonio', 29.42, -98.49, 1434625], ['San Diego', 32.72, -117.16, 1386932],
    ['Dallas', 32.78, -96.80, 1304379], ['San Jose', 37.34, -121.89, 1013240],
    ['Austin', 30.27, -97.74, 961855], ['Jacksonville', 30.33, -81.66, 949611],
    ['Fort Worth', 32.76, -97.33, 918915], ['Columbus', 39.96, -82.99, 905748],
    ['Charlotte', 35.23, -80.84, 874579], ['Indianapolis', 39.77, -86.16, 887642],
    ['San Francisco', 37.77, -122.42, 873965], ['Seattle', 47.61, -122.33, 737015],
    ['Denver', 39.74, -104.99, 715522], ['Oklahoma City', 35.47, -97.52, 681054],
    ['Nashville', 36.16, -86.78, 689447], ['Washington', 38.91, -77.04, 689545],
    ['El Paso', 31.76, -106.49, 678815], ['Boston', 42.36, -71.06, 675647],
    ['Portland', 45.52, -122.68, 652503], ['Las Vegas', 36.17, -115.14, 641903],
    ['Detroit', 42.33, -83.05, 639111], ['Memphis', 35.15, -90.05, 633104],
    ['Louisville', 38.25, -85.76, 633045], ['Baltimore', 39.29, -76.61, 585708],
    ['Milwaukee', 43.04, -87.91, 577222], ['Albuquerque', 35.08, -106.65, 564559],
    ['Tucson', 32.22, -110.97, 542629], ['Fresno', 36.74, -119.79, 542107],
    ['Sacramento', 38.58, -121.49, 524943], ['Kansas City', 39.10, -94.58, 508090],
    ['Mesa', 33.42, -111.83, 504258], ['Atlanta', 33.75, -84.39, 498715],
    ['Omaha', 41.26, -95.93, 486051], ['Colorado Springs', 38.83, -104.82, 478961],
    ['Raleigh', 35.78, -78.64, 467665], ['Miami', 25.76, -80.19, 442241],
    ['Oakland', 37.80, -122.27, 440646], ['Minneapolis', 44.98, -93.27, 429954],
    ['Tulsa', 36.15, -95.99, 413066], ['Wichita', 37.69, -97.34, 397532],
    ['New Orleans', 29.95, -90.07, 383997], ['Arlington', 32.74, -97.11, 394266],
    ['Cleveland', 41.50, -81.69, 372624], ['Tampa', 27.95, -82.46, 384959],
    ['Bakersfield', 35.37, -119.02, 403455], ['Aurora', 39.73, -104.83, 386261],
    ['Honolulu', 21.31, -157.86, 350964], ['Anaheim', 33.84, -117.91, 346824],
    ['Santa Ana', 33.75, -117.87, 310227], ['Corpus Christi', 27.80, -97.40, 317863],
    ['Riverside', 33.95, -117.40, 314998], ['St. Louis', 38.63, -90.20, 301578],
    ['Lexington', 38.04, -84.50, 322570], ['Pittsburgh', 40.44, -79.99, 302971],
    ['Cincinnati', 39.10, -84.51, 309317], ['Toledo', 41.66, -83.58, 270871],
    ['Greensboro', 36.07, -79.79, 299035], ['Lincoln', 40.81, -96.68, 291082],
    ['Orlando', 28.54, -81.38, 307573], ['Buffalo', 42.89, -78.88, 278349],
    ['Fort Wayne', 41.08, -85.14, 263886], ['Chandler', 33.31, -111.84, 275987],
    ['Madison', 43.07, -89.40, 269840], ['Lubbock', 33.58, -101.86, 257141],
    ['Reno', 39.53, -119.81, 264165], ['Norfolk', 36.85, -76.29, 238005],
    ['Winston-Salem', 36.10, -80.24, 249545], ['Baton Rouge', 30.45, -91.15, 227470],
    ['Birmingham', 33.52, -86.81, 200733], ['Des Moines', 41.59, -93.62, 214133],
    ['Little Rock', 34.75, -92.29, 202591], ['Richmond', 37.54, -77.44, 226610],
    ['Spokane', 47.66, -117.43, 228989], ['Montgomery', 32.37, -86.30, 200603],
    ['Grand Rapids', 42.96, -85.67, 198917], ['Huntsville', 34.73, -86.59, 215006],
    ['Salt Lake City', 40.76, -111.89, 199723], ['Knoxville', 35.96, -83.92, 190740],
    ['Chattanooga', 35.05, -85.31, 181099], ['Mobile', 30.69, -88.04, 187041],
    ['Shreveport', 32.53, -93.75, 187112], ['Jackson', 32.30, -90.18, 153701],
    ['Columbia', 34.00, -81.03, 136632], ['Charleston', 32.78, -79.93, 150227],
    ['Savannah', 32.08, -81.09, 147780], ['Augusta', 33.47, -81.97, 202081],
    ['Amarillo', 35.22, -101.83, 200393], ['Wilmington', 34.23, -77.94, 115451],
    ['Tallahassee', 30.44, -84.28, 196169], ['Springfield', 37.21, -93.29, 169176],
    ['Fayetteville', 35.05, -78.88, 208501], ['Rockford', 42.27, -89.09, 148655],
    ['Peoria', 40.69, -89.59, 113150], ['Evansville', 37.97, -87.57, 117298],
    ['Topeka', 39.05, -95.68, 126587], ['Waco', 31.55, -97.15, 138486],
    ['Sioux Falls', 43.55, -96.70, 192517], ['Cedar Rapids', 41.98, -91.67, 137710],
    ['Davenport', 41.52, -90.58, 101724], ['Green Bay', 44.51, -88.02, 107395],
    ['Roanoke', 37.27, -79.94, 100011], ['Lynchburg', 37.41, -79.14, 79009],
    ['Gainesville', 29.65, -82.32, 141085], ['Pensacola', 30.42, -87.22, 54312],
    ['Lafayette', 30.22, -92.02, 121374], ['Fort Smith', 35.39, -94.42, 89142],
    ['Springfield', 39.80, -89.64, 114394], ['Champaign', 40.12, -88.24, 88302],
    ['Bloomington', 39.17, -86.53, 79968], ['Terre Haute', 39.47, -87.41, 58389],
    ['South Bend', 41.68, -86.25, 103453], ['Kalamazoo', 42.29, -85.59, 73598],
    ['Lansing', 42.73, -84.56, 112644], ['Flint', 43.01, -83.69, 81252],
    ['Dayton', 39.76, -84.19, 137644], ['Akron', 41.08, -81.52, 190469],
    ['Youngstown', 41.10, -80.65, 60068], ['Erie', 42.13, -80.09, 94831],
    ['Duluth', 46.79, -92.10, 86697], ['Fargo', 46.88, -96.79, 125990],
    ['Bismarck', 46.81, -100.78, 73622], ['Rapid City', 44.08, -103.23, 74703],
    ['Billings', 45.79, -108.50, 117116], ['Cheyenne', 41.14, -104.82, 65132],
    ['Boise', 43.62, -116.21, 235684], ['Idaho Falls', 43.49, -112.03, 64818],
    ['Great Falls', 47.51, -111.30, 60442], ['Missoula', 46.87, -113.99, 75516],
    ['Wichita Falls', 33.91, -98.49, 102316], ['Abilene', 32.45, -99.73, 125182],
    ['Odessa', 31.85, -102.37, 114428], ['Midland', 31.99, -102.08, 132524],
    ['Tyler', 32.35, -95.30, 105995], ['Killeen', 31.12, -97.73, 153095],
    ['College Station', 30.63, -96.33, 120511], ['Denton', 33.21, -97.13, 139869],
    ['McAllen', 26.20, -98.23, 142696], ['Brownsville', 25.90, -97.50, 186738],
    ['Laredo', 27.51, -99.51, 255205], ['Galveston', 29.30, -94.80, 53219],
    ['Beaumont', 30.08, -94.13, 115282], ['Norman', 35.22, -97.44, 128026],
    ['Stillwater', 36.12, -97.06, 48394], ['Enid', 36.40, -97.88, 51308],
    ['Lawton', 34.61, -98.39, 90381], ['Joplin', 37.08, -94.51, 51762],
    ['Columbia', 38.95, -92.33, 126254], ['Jefferson City', 38.58, -92.17, 43228],
    ['Manhattan', 39.18, -96.57, 54100], ['Salina', 38.84, -97.61, 46550],
    ['Hutchinson', 38.06, -97.93, 40006], ['Dodge City', 37.75, -100.02, 27788],
    ['Grand Island', 40.92, -98.34, 53131], ['Kearney', 40.70, -99.08, 33790],
    ['North Platte', 41.14, -100.76, 23390], ['Scottsbluff', 41.87, -103.66, 14758],
    ['Muskogee', 35.75, -95.37, 36878], ['Ada', 34.77, -96.68, 16481],
    ['Ardmore', 34.17, -97.14, 24870], ['Durant', 33.99, -96.37, 18589],
    ['Camden', 34.25, -80.60, 7385], ['Lugoff', 34.22, -80.69, 8407],
    ['Sumter', 33.92, -80.34, 43463], ['Florence', 34.20, -79.76, 39899],
    ['Orangeburg', 33.49, -80.86, 13964], ['Rock Hill', 34.92, -81.03, 74372],
    ['Spartanburg', 34.95, -81.93, 38732], ['Greenville', 34.85, -82.39, 70720],
    ['Anderson', 34.50, -82.65, 27973], ['Aiken', 33.56, -81.72, 30658],
];

// Full dataset: ~17k US populated places (pop >= 1000) from GeoNames. Falls back
// to the small curated list only if that generated file is missing.
function baseList() {
    try {
        const full = require('./mst_cities_data');
        if (Array.isArray(full) && full.length) return full;
    } catch (e) { /* generated file absent — use curated */ }
    return CURATED;
}

let _cache = null;

// Returns [{ name, lat, lon, population }]. A caller can override the whole set
// by assigning window.vortexData.mstCities before first use.
function getCities() {
    if (_cache) return _cache;
    const override = (typeof window !== 'undefined' && window.vortexData && window.vortexData.mstCities);
    const source = Array.isArray(override) ? override : baseList();
    _cache = source
        .filter((c) => Array.isArray(c) && c.length >= 3)
        .map((c) => ({ name: c[0], lat: +c[1], lon: +c[2], population: +(c[3] || 0) }));
    return _cache;
}

module.exports = { getCities };
