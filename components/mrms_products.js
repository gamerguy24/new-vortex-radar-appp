/*
 * components/mrms_products.js
 * The MRMS product catalogue: what the layer can show, and how to colour it.
 *
 * The bucket (noaa-mrms-pds) carries 243 CONUS products. Most are noise for a
 * radar app — nineteen elevation tilts of three moments each, a dozen
 * flash-flood model variants — so this is a curated set: the fields a warning
 * or chase desk actually reads, grouped the way they are thought about.
 *
 * Every ramp here was set from the REAL distribution of a live grid rather than
 * guessed. Where a percentile is quoted in a comment it came from decoding that
 * product off S3 and sorting the values, so the interesting range gets the
 * colour and the long thin tail does not swallow it.
 *
 * Fields per product:
 *   path   S3 prefix under the bucket (no date; the layer appends it)
 *   unit   what the numbers are, for the legend
 *   step   decimation when painting. The rotation grids are 14000x7000 —
 *          four times the pixels of everything else — and painting them at
 *          full density is what would make this layer feel slow.
 *   floor  values at or below this are "nothing here" and draw transparent.
 *          MRMS uses -999 for missing and -3 for no radar coverage, and some
 *          products legitimately go to zero, so it is per-product.
 *   ramp   ascending [value, [r,g,b]] stops; below the first stop is
 *          transparent, at or above the last clamps to the last colour.
 *   discrete  categorical products snap to the stop at or below the value
 *             instead of blending (see PrecipFlag).
 */

// ── shared ramps ─────────────────────────────────────────────────────────────

// Reflectivity is deliberately NOT defined here: it uses the app's own REF
// colour table so MRMS and the single-site radar agree, and so a user's custom
// palette applies to both.
const RAMP_AZSHEAR = [
    [1, [40, 70, 120]], [2, [40, 130, 170]], [3, [60, 180, 130]], [5, [225, 215, 90]],
    [8, [240, 150, 55]], [12, [225, 70, 60]], [18, [175, 30, 60]], [26, [215, 120, 235]],
];

const RAMP_ROTATION_TRACK = [
    [2, [45, 75, 125]], [4, [45, 140, 175]], [6, [70, 185, 135]], [10, [228, 218, 95]],
    [16, [240, 150, 55]], [24, [225, 70, 60]], [34, [175, 30, 60]], [48, [215, 120, 235]],
];

// MESH in mm. Severe hail (1 in) is 25 mm and significant (2 in) is 50 mm, so
// the ramp changes character at both.
const RAMP_MESH = [
    [3, [70, 130, 190]], [10, [70, 185, 150]], [19, [225, 215, 90]], [25, [240, 150, 55]],
    [32, [230, 80, 55]], [40, [180, 30, 60]], [50, [205, 110, 230]], [65, [240, 220, 250]],
];

// Precipitation rate, mm/hr. p50 is 0.9 and p99 is 36, so the low end gets most
// of the resolution or almost every pixel lands in one colour.
const RAMP_PRATE = [
    [0.2, [90, 150, 200]], [1, [70, 185, 150]], [2.5, [110, 205, 100]], [6, [228, 218, 95]],
    [12, [240, 160, 55]], [25, [230, 80, 55]], [50, [175, 30, 60]], [100, [210, 120, 235]],
];

// Storm-total / accumulated precipitation, mm.
const RAMP_QPE = [
    [1, [80, 140, 200]], [5, [70, 185, 150]], [10, [110, 205, 100]], [25, [228, 218, 95]],
    [50, [240, 160, 55]], [75, [230, 80, 55]], [125, [175, 30, 60]], [200, [210, 120, 235]],
];

// Echo top height, km.
const RAMP_ECHOTOP = [
    [2, [50, 80, 140]], [5, [50, 150, 185]], [8, [70, 190, 140]], [11, [228, 218, 95]],
    [14, [240, 155, 55]], [16, [228, 75, 58]], [18, [180, 30, 60]], [21, [215, 125, 235]],
];

// Vertically integrated liquid, kg/m^2.
const RAMP_VIL = [
    [0.5, [55, 90, 150]], [2, [50, 150, 185]], [5, [70, 190, 140]], [12, [228, 218, 95]],
    [25, [240, 155, 55]], [40, [228, 75, 58]], [55, [180, 30, 60]], [75, [215, 125, 235]],
];

// Probability / percentage products.
const RAMP_PROB = [
    [5, [55, 90, 150]], [15, [50, 150, 185]], [30, [70, 190, 140]], [50, [228, 218, 95]],
    [70, [240, 155, 55]], [85, [228, 75, 58]], [95, [180, 30, 60]],
];


/*
 * MRMS precipitation-type flag. A code, not a scale — blending between "snow"
 * and "hail" would invent a colour that means nothing, so this ramp is
 * discrete and every stop is an exact code from the MRMS table.
 */
const RAMP_PTYPE = [
    [1, [60, 190, 90]],     // warm stratiform rain
    [3, [120, 190, 235]],   // snow
    [6, [235, 190, 45]],    // convective
    [7, [230, 70, 70]],     // hail
    [10, [45, 150, 80]],    // cool stratiform rain
    [91, [150, 100, 220]],  // tropical stratiform
    [96, [200, 80, 200]],   // tropical convective
];
const PTYPE_NAMES = {
    1: 'Rain (warm strat.)', 3: 'Snow', 6: 'Convective', 7: 'Hail',
    10: 'Rain (cool strat.)', 91: 'Tropical strat.', 96: 'Tropical conv.',
};

// ── catalogue ────────────────────────────────────────────────────────────────

const MRMS_PRODUCTS = [
    // --- Reflectivity (uses the app's REF palette; ramp is null on purpose) ---
    {
        id: 'ref_base', group: 'Reflectivity', label: 'Base Reflectivity',
        path: 'CONUS/MergedBaseReflectivityQC_00.50', unit: 'dBZ',
        reflectivity: true, floor: -30, step: 2,
    },
    {
        id: 'ref_comp', group: 'Reflectivity', label: 'Composite Reflectivity',
        path: 'CONUS/MergedReflectivityQCComposite_00.50', unit: 'dBZ',
        reflectivity: true, floor: -30, step: 2,
    },
    {
        id: 'ref_lowest', group: 'Reflectivity', label: 'Reflectivity at Lowest Altitude',
        path: 'CONUS/MergedReflectivityAtLowestAltitude_00.50', unit: 'dBZ',
        reflectivity: true, floor: -30, step: 2,
    },
    {
        id: 'ref_lowlevel', group: 'Reflectivity', label: 'Low-Level Composite',
        path: 'CONUS/LowLevelCompositeReflectivity_00.50', unit: 'dBZ',
        reflectivity: true, floor: -30, step: 2,
    },

    // --- Rotation. These grids are 14000x7000, hence the coarser step. ---
    {
        id: 'azshear_02', group: 'Rotation', label: 'AzShear 0–2 km',
        path: 'CONUS/MergedAzShear_0-2kmAGL_00.50', unit: '×10⁻³ s⁻¹',
        ramp: RAMP_AZSHEAR, floor: 0.5, step: 4,
    },
    {
        id: 'azshear_36', group: 'Rotation', label: 'AzShear 3–6 km',
        path: 'CONUS/MergedAzShear_3-6kmAGL_00.50', unit: '×10⁻³ s⁻¹',
        ramp: RAMP_AZSHEAR, floor: 0.5, step: 4,
    },
    {
        id: 'rot_30', group: 'Rotation', label: 'Rotation Track 30 min',
        path: 'CONUS/RotationTrack30min_00.50', unit: '×10⁻³ s⁻¹',
        ramp: RAMP_ROTATION_TRACK, floor: 1, step: 4,
    },
    {
        id: 'rot_60', group: 'Rotation', label: 'Rotation Track 60 min',
        path: 'CONUS/RotationTrack60min_00.50', unit: '×10⁻³ s⁻¹',
        ramp: RAMP_ROTATION_TRACK, floor: 1, step: 4,
    },
    {
        id: 'rot_120', group: 'Rotation', label: 'Rotation Track 120 min',
        path: 'CONUS/RotationTrack120min_00.50', unit: '×10⁻³ s⁻¹',
        ramp: RAMP_ROTATION_TRACK, floor: 1, step: 4,
    },

    // --- Hail ---
    {
        id: 'mesh', group: 'Hail', label: 'MESH (max hail size)',
        path: 'CONUS/MESH_00.50', unit: 'mm', ramp: RAMP_MESH, floor: 1, step: 2,
    },
    {
        id: 'mesh_30', group: 'Hail', label: 'MESH Max 30 min',
        path: 'CONUS/MESH_Max_30min_00.50', unit: 'mm', ramp: RAMP_MESH, floor: 1, step: 2,
    },
    {
        id: 'mesh_60', group: 'Hail', label: 'MESH Max 60 min',
        path: 'CONUS/MESH_Max_60min_00.50', unit: 'mm', ramp: RAMP_MESH, floor: 1, step: 2,
    },
    {
        id: 'posh', group: 'Hail', label: 'POSH (severe hail prob.)',
        path: 'CONUS/POSH_00.50', unit: '%', ramp: RAMP_PROB, floor: 1, step: 2,
    },

    // --- Storm structure ---
    {
        id: 'echotop_18', group: 'Storm Structure', label: 'Echo Top 18 dBZ',
        path: 'CONUS/EchoTop_18_00.50', unit: 'km', ramp: RAMP_ECHOTOP, floor: 0.5, step: 2,
    },
    {
        id: 'echotop_50', group: 'Storm Structure', label: 'Echo Top 50 dBZ',
        path: 'CONUS/EchoTop_50_00.50', unit: 'km', ramp: RAMP_ECHOTOP, floor: 0.5, step: 2,
    },
    {
        id: 'vil', group: 'Storm Structure', label: 'VIL',
        path: 'CONUS/VIL_00.50', unit: 'kg/m²', ramp: RAMP_VIL, floor: 0.2, step: 2,
    },
    {
        id: 'vil_density', group: 'Storm Structure', label: 'VIL Density',
        path: 'CONUS/VIL_Density_00.50', unit: 'g/m³', ramp: RAMP_VIL, floor: 0.2, step: 2,
    },
    {
        id: 'vii', group: 'Storm Structure', label: 'VII (ice)',
        path: 'CONUS/VII_00.50', unit: 'kg/m²', ramp: RAMP_VIL, floor: 0.2, step: 2,
    },

    // --- Precipitation ---
    {
        id: 'precip_rate', group: 'Precipitation', label: 'Precipitation Rate',
        path: 'CONUS/PrecipRate_00.00', unit: 'mm/hr', ramp: RAMP_PRATE, floor: 0.1, step: 2,
    },
    {
        id: 'precip_flag', group: 'Precipitation', label: 'Precipitation Type',
        path: 'CONUS/PrecipFlag_00.00', unit: '', ramp: RAMP_PTYPE, floor: 0.5, step: 2,
        discrete: true, categories: PTYPE_NAMES,
    },
    {
        id: 'qpe_01h', group: 'Precipitation', label: 'Radar QPE 1 hour',
        path: 'CONUS/RadarOnly_QPE_01H_00.00', unit: 'mm', ramp: RAMP_QPE, floor: 0.5, step: 2,
    },
    {
        id: 'qpe_03h', group: 'Precipitation', label: 'Radar QPE 3 hour',
        path: 'CONUS/RadarOnly_QPE_03H_00.00', unit: 'mm', ramp: RAMP_QPE, floor: 0.5, step: 2,
    },
    {
        id: 'qpe_24h', group: 'Precipitation', label: 'Radar QPE 24 hour',
        path: 'CONUS/RadarOnly_QPE_24H_00.00', unit: 'mm', ramp: RAMP_QPE, floor: 0.5, step: 2,
    },
    {
        id: 'qpe_ms_01h', group: 'Precipitation', label: 'Multi-Sensor QPE 1 hour',
        path: 'CONUS/MultiSensor_QPE_01H_Pass2_00.00', unit: 'mm', ramp: RAMP_QPE, floor: 0.5, step: 2,
    },
    {
        id: 'qpe_ms_24h', group: 'Precipitation', label: 'Multi-Sensor QPE 24 hour',
        path: 'CONUS/MultiSensor_QPE_24H_Pass2_00.00', unit: 'mm', ramp: RAMP_QPE, floor: 0.5, step: 2,
    },

    /*
     * NO LIGHTNING GROUP, deliberately.
     *
     * Checked against the live bucket: NLDN flash density was 6.4 hours stale
     * (it is Vaisala's commercial feed and NOAA's public mirror runs
     * intermittently), and both LightningProbability grids came back with all
     * 24.5 million points missing. A menu entry that paints nothing reads as a
     * broken app, so these are left out until the feeds are dependable.
     */
];

const BY_ID = Object.fromEntries(MRMS_PRODUCTS.map((p) => [p.id, p]));

function getProduct(id) { return BY_ID[id] || BY_ID.ref_base; }

// Products grouped in catalogue order, for building the picker.
function groupedProducts() {
    const out = [];
    for (const p of MRMS_PRODUCTS) {
        let g = out.find((x) => x.group === p.group);
        if (!g) { g = { group: p.group, items: [] }; out.push(g); }
        g.items.push(p);
    }
    return out;
}

/*
 * Build a 256-entry colour lookup for a product's ramp.
 *
 * Sampling the ramp once into a table keeps the per-pixel work to an array
 * index — a CONUS grid is 24 million points, and interpolating the stops at
 * each one is the difference between a layer that appears and one that hangs
 * the tab.
 */
function buildRampLUT(product, size = 256) {
    const ramp = product.ramp || [];
    const lut = new Uint8ClampedArray(size * 4);
    if (!ramp.length) return { lut, min: 0, max: 1 };

    const min = ramp[0][0];
    const max = ramp[ramp.length - 1][0];
    const span = (max - min) || 1;

    for (let i = 0; i < size; i++) {
        const v = min + (i / (size - 1)) * span;
        let c = null;
        if (product.discrete) {
            // Snap to the stop at or below the value; never blend a category.
            for (let s = ramp.length - 1; s >= 0; s--) {
                if (v >= ramp[s][0] - 1e-9) { c = ramp[s][1]; break; }
            }
        } else if (v <= ramp[0][0]) {
            c = ramp[0][1];
        } else if (v >= max) {
            c = ramp[ramp.length - 1][1];
        } else {
            for (let s = 0; s < ramp.length - 1; s++) {
                const [lv, lc] = ramp[s], [rv, rc] = ramp[s + 1];
                if (v >= lv && v <= rv) {
                    const t = rv > lv ? (v - lv) / (rv - lv) : 0;
                    c = [
                        Math.round(lc[0] + (rc[0] - lc[0]) * t),
                        Math.round(lc[1] + (rc[1] - lc[1]) * t),
                        Math.round(lc[2] + (rc[2] - lc[2]) * t),
                    ];
                    break;
                }
            }
        }
        if (!c) { lut[i * 4 + 3] = 0; continue; }
        lut[i * 4] = c[0]; lut[i * 4 + 1] = c[1]; lut[i * 4 + 2] = c[2]; lut[i * 4 + 3] = 255;
    }
    return { lut, min, max };
}

export { MRMS_PRODUCTS, PTYPE_NAMES, getProduct, groupedProducts, buildRampLUT };
