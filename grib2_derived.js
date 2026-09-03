/*
 * grib2_derived.js
 * Registry of forecast fields that are COMPUTED from several GRIB messages.
 *
 * Most of what a severe-weather desk actually reads off a map is not stored in
 * the model file. Bulk shear is a u/v pair. A lapse rate is two temperatures
 * and the two heights they sit at. The composite indices are products of three
 * or four fields. So each entry here names the messages it needs (variable +
 * exact level string, as they appear in the NOAA `.idx`) and a `combine`
 * function that turns their physical values into the plotted quantity.
 *
 * Contract for `combine`:
 *   - receives an array of physical values in GRIB units, in `inputs` order
 *   - returns the value in the RAMP's units (see grib2_render toRampUnits:
 *     'shear' converts m/s to knots for you, most other kinds are identity)
 *   - returns null where the quantity is not defined
 * A pixel is drawn only where every input is present, so a partially evaluated
 * parameter never reaches the map.
 *
 * A derived field resolves only if EVERY input is in the run being viewed, so
 * entries degrade by disappearing on models that lack the ingredients rather
 * than by rendering something wrong. Levels differ between models where noted.
 */

const MS_TO_KT = 1.943844;

/*
 * Equivalent potential temperature from temperature, specific humidity and
 * pressure — Bolton (1980), the formulation the SPC and SHARPpy use.
 *
 * Mixing ratio and vapour pressure come from specific humidity rather than a
 * dew point because every model in the catalogue carries SPFH at 2 m, while
 * 2 m DPT is missing from some of them.
 */
function thetaE(tK, q, pPa) {
    if (!(tK > 150) || !(pPa > 1000) || !(q >= 0)) return null;
    const p = pPa / 100;                        // hPa
    const r = Math.max(q, 1e-8) / (1 - Math.min(q, 0.99));   // mixing ratio, kg/kg
    const e = p * r / (0.622 + r);              // vapour pressure, hPa
    if (!(e > 0)) return null;
    // Bolton eq. 21: temperature at the lifting condensation level
    const tl = 2840 / (3.5 * Math.log(tK) - Math.log(e) - 4.805) + 55;
    // Bolton eq. 39
    return tK * Math.pow(1000 / p, 0.2854 * (1 - 0.28 * r))
        * Math.exp((3.376 / tl - 0.00254) * 1000 * r * (1 + 0.81 * r));
}

/*
 * Height above ground for a field stored as height above mean sea level.
 * HRRR gives the LCL as "level of adiabatic condensation from sfc" in metres
 * MSL, which over the Rockies is thousands of metres of terrain rather than
 * cloud base; subtracting the surface height is what makes it a cloud base.
 */
function agl(levelMsl, surfaceHgt) {
    const h = levelMsl - surfaceHgt;
    return h < 0 ? 0 : h;
}

const DERIVED = {
    // ── Wind Shear ───────────────────────────────────────────────────────────
    bshr_06: {
        label: '0–6 km Bulk Shear', kind: 'shear', category: 'shear',
        inputs: [['VUCSH', '0-6000 m above ground'], ['VVCSH', '0-6000 m above ground']],
        combine: ([u, v]) => Math.hypot(u, v),
    },
    bshr_01: {
        label: '0–1 km Bulk Shear', kind: 'shear', category: 'shear',
        inputs: [['VUCSH', '0-1000 m above ground'], ['VVCSH', '0-1000 m above ground']],
        combine: ([u, v]) => Math.hypot(u, v),
    },
    /*
     * Surface-to-500 mb bulk shear: the VECTOR DIFFERENCE between the two
     * levels, then its magnitude. Taking the difference of the two speeds
     * instead would report near-zero shear for a wind that reverses direction
     * with height, which is the exact situation the field exists to find.
     */
    bshr_sfc500: {
        label: 'Bulk Shear: Sfc–500 mb', kind: 'shear', category: 'shear',
        inputs: [['UGRD', '10 m above ground'], ['VGRD', '10 m above ground'],
            ['UGRD', '500 mb'], ['VGRD', '500 mb']],
        combine: ([u0, v0, u5, v5]) => Math.hypot(u5 - u0, v5 - v0),
    },
    storm_motion: {
        label: 'Storm Motion (Bunkers)', kind: 'wind', category: 'shear',
        inputs: [['USTM', '0-6000 m above ground'], ['VSTM', '0-6000 m above ground']],
        altInputs: [['USTM', '6000-0 m above ground'], ['VSTM', '6000-0 m above ground']],
        combine: ([u, v]) => Math.hypot(u, v),
    },
    wind_10m: {
        label: '10 m AGL Wind', kind: 'wind', category: 'surface',
        inputs: [['UGRD', '10 m above ground'], ['VGRD', '10 m above ground']],
        combine: ([u, v]) => Math.hypot(u, v),
    },
    wind_500: {
        label: '500 mb Wind', kind: 'wind', category: 'dynamics',
        inputs: [['UGRD', '500 mb'], ['VGRD', '500 mb']],
        combine: ([u, v]) => Math.hypot(u, v),
    },
    wind_250: {
        label: '250 mb Wind (Jet)', kind: 'wind', category: 'dynamics',
        inputs: [['UGRD', '250 mb'], ['VGRD', '250 mb']],
        combine: ([u, v]) => Math.hypot(u, v),
    },
    wind_850: {
        label: '850 mb Wind', kind: 'wind', category: 'dynamics',
        inputs: [['UGRD', '850 mb'], ['VGRD', '850 mb']],
        combine: ([u, v]) => Math.hypot(u, v),
    },

    /*
     * ── Wind barbs ───────────────────────────────────────────────────────────
     *
     * Same u/v inputs as the wind-speed fields, but rendered as glyphs rather
     * than shading (grib2_barbs.js), because a colour ramp cannot show
     * direction and direction is half of what a wind field means. `barbs: true`
     * is what routes them to the glyph renderer; there is no combine function
     * because nothing is being reduced to a single value per pixel.
     */
    barbs_10m: {
        label: '10 m Wind Barbs', kind: 'barb', category: 'surface', barbs: true,
        inputs: [['UGRD', '10 m above ground'], ['VGRD', '10 m above ground']],
    },
    barbs_shear06: {
        label: '0–6 km Shear Barbs', kind: 'barb', category: 'shear', barbs: true,
        inputs: [['VUCSH', '0-6000 m above ground'], ['VVCSH', '0-6000 m above ground']],
    },
    barbs_850: {
        label: '850 mb Wind Barbs', kind: 'barb', category: 'dynamics', barbs: true,
        inputs: [['UGRD', '850 mb'], ['VGRD', '850 mb']],
    },
    barbs_500: {
        label: '500 mb Wind Barbs', kind: 'barb', category: 'dynamics', barbs: true,
        inputs: [['UGRD', '500 mb'], ['VGRD', '500 mb']],
    },
    barbs_250: {
        label: '250 mb Wind Barbs', kind: 'barb', category: 'dynamics', barbs: true,
        inputs: [['UGRD', '250 mb'], ['VGRD', '250 mb']],
    },

    // ── Instability ──────────────────────────────────────────────────────────
    /*
     * 700–500 mb lapse rate, in °C per km of ACTUAL thickness rather than an
     * assumed 3 km. The layer's depth varies by hundreds of metres between a
     * cold trough and a warm ridge, and dividing by a constant would bake that
     * error straight into the number a forecaster reads.
     */
    lapse_700_500: {
        label: 'Lapse Rate: 700–500 mb', kind: 'lapse', category: 'instability',
        inputs: [['TMP', '700 mb'], ['TMP', '500 mb'], ['HGT', '700 mb'], ['HGT', '500 mb']],
        combine: ([t7, t5, z7, z5]) => {
            const dz = (z5 - z7) / 1000;
            return dz > 0.5 ? (t7 - t5) / dz : null;
        },
    },
    lapse_850_500: {
        label: 'Lapse Rate: 850–500 mb', kind: 'lapse', category: 'instability',
        inputs: [['TMP', '850 mb'], ['TMP', '500 mb'], ['HGT', '850 mb'], ['HGT', '500 mb']],
        combine: ([t8, t5, z8, z5]) => {
            const dz = (z5 - z8) / 1000;
            return dz > 0.5 ? (t8 - t5) / dz : null;
        },
    },
    lcl_height: {
        label: 'LCL Height (AGL)', kind: 'height', category: 'instability',
        inputs: [['HGT', 'level of adiabatic condensation from sfc'], ['HGT', 'surface']],
        combine: ([lcl, sfc]) => agl(lcl, sfc),
    },
    lfc_height: {
        label: 'LFC Height (AGL)', kind: 'height', category: 'instability',
        inputs: [['HGT', 'level of free convection'], ['HGT', 'surface']],
        combine: ([lfc, sfc]) => agl(lfc, sfc),
    },
    theta_e_2m: {
        label: '2 m Theta-e', kind: 'thetae', category: 'surface',
        inputs: [['TMP', '2 m above ground'], ['SPFH', '2 m above ground'], ['PRES', 'surface']],
        combine: ([t, q, p]) => thetaE(t, q, p),
    },

    // ── Composite parameters ─────────────────────────────────────────────────
    /*
     * Energy-Helicity Index: CAPE * SRH / 160000, the standard scaling. Uses
     * mixed-layer CAPE, which is what the index was tuned against; surface CAPE
     * would read high off a shallow hot layer that never actually lifts.
     */
    ehi_03: {
        label: 'EHI: 0–3 km', kind: 'ehi', category: 'composite',
        inputs: [['CAPE', '180-0 mb above ground'], ['HLCY', '3000-0 m above ground']],
        combine: ([cape, srh]) => (cape * srh) / 160000,
    },
    ehi_01: {
        label: 'EHI: 0–1 km', kind: 'ehi', category: 'composite',
        inputs: [['CAPE', '180-0 mb above ground'], ['HLCY', '1000-0 m above ground']],
        combine: ([cape, srh]) => (cape * srh) / 160000,
    },
    /*
     * Supercell Composite Parameter (SPC's effective-layer formulation, using
     * the fixed layers these files carry): MUCAPE/1000 * SRH3/50 * shear term.
     *
     * The shear term is SPC's: zero below 10 m/s, capped at 1.5 above 20 m/s,
     * linear between. Without that cap a single very sheared but capped
     * environment would dominate the map.
     */
    scp: {
        label: 'Supercell Composite', kind: 'scp', category: 'composite',
        inputs: [['CAPE', '255-0 mb above ground'], ['HLCY', '3000-0 m above ground'],
            ['VUCSH', '0-6000 m above ground'], ['VVCSH', '0-6000 m above ground']],
        combine: ([mucape, srh, u, v]) => {
            const bwd = Math.hypot(u, v);            // m/s
            let shearTerm;
            if (bwd < 10) shearTerm = 0;
            else if (bwd > 20) shearTerm = 1.5;
            else shearTerm = bwd / 20;
            return (mucape / 1000) * (srh / 50) * shearTerm;
        },
    },

    /*
     * ── Anomalies ────────────────────────────────────────────────────────────
     *
     * How far the forecast departs from normal, which is often the more useful
     * question: 25 mm of precipitable water is unremarkable on the Gulf coast
     * and extraordinary over Montana.
     *
     * `climo` names a long-term-mean grid (model_climatology.js). The server
     * resolves it to a sampler and appends its value to `combine`'s arguments
     * after the GRIB inputs, so normal arrives as the last argument.
     *
     * The normals are the NCEP/NCAR 1981-2010 daily climatology, on a much
     * coarser grid (2.5° for moisture, ~1.9° Gaussian for temperature) than any
     * of the forecast models. That is inherent to an anomaly: it compares a
     * sharp field against a smooth one, and the departure is only as detailed
     * as the climatology behind it.
     */
    pwat_anomaly: {
        label: 'PWAT Anomaly', kind: 'anom_pwat', category: 'anomaly',
        inputs: [['PWAT', 'entire atmosphere']],
        climo: 'pwat',                       // kg/m2, the same unit as GRIB PWAT
        combine: ([pwat, normal]) => pwat - normal,
    },
    t2m_anomaly: {
        label: '2 m Temp. Anomaly', kind: 'anom_temp', category: 'anomaly',
        inputs: [['TMP', '2 m above ground']],
        climo: 't2m',                        // Kelvin, so the difference is °C
        combine: ([t, normal]) => t - normal,
    },

    // ── Precipitation type ───────────────────────────────────────────────────
    /*
     * The four category flags collapsed to one index, checked in order of
     * hazard so a mixed grid point reports the worst thing falling on it:
     * freezing rain, then sleet, then snow, then rain.
     */
    ptype: {
        label: 'Precipitation Type', kind: 'ptype', category: 'ptype',
        inputs: [['CRAIN', 'surface'], ['CSNOW', 'surface'],
            ['CFRZR', 'surface'], ['CICEP', 'surface']],
        combine: ([rain, snow, frzr, icep]) => {
            if (frzr >= 0.5) return 3;
            if (icep >= 0.5) return 4;
            if (snow >= 0.5) return 2;
            if (rain >= 0.5) return 1;
            return null;             // nothing falling here: leave it transparent
        },
    },
};

module.exports = { DERIVED, thetaE };
