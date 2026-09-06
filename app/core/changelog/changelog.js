/*
 * changelog.js
 * "What's New" screen — a running list of user-facing additions so users can see
 * what's changed. To add a release, unshift a new entry onto CHANGELOG (newest
 * first); each item is a { title, desc } feature line.
 *
 * THIS IS THE CHANGELOG THAT SHIPS. tools/CHANGELOG.md is a leftover from the
 * upstream project — it stopped in 2022 and its links still point at that repo.
 * Add entries here.
 *
 * Write for the person using the app, not the person who wrote the patch: what
 * they can now do, and why it helps. Internal refactors and bug fixes nobody
 * noticed do not belong here; a bug they DID notice ("the radar no longer
 * disappears while you drag") does.
 *
 * This file lives under app/, so it only reaches anyone after `npm run build`
 * — which also rewrites tools/size.txt, the cache-buster the page uses. Editing
 * it without rebuilding changes nothing for users.
 */

const display_vortex_dialog = require('../menu/vortex_dialog');

const CHANGELOG = [
    {
        date: 'August 31, 2026',
        items: [
            { title: 'Playback no longer crashes phones', desc: 'Pressing play could lock the app up and take the phone with it. Three causes: it queued the next frame on a fixed timer whether or not the last one had finished drawing, so on a slow device the frames piled up until nothing responded; it held ten full scans in memory at once, which a phone does not have; and tapping play while it was still loading did nothing, with no way to stop it. It now waits for each frame before scheduling the next, keeps five scans on a phone, and a second tap cancels a load that is under way.' },
            { title: 'Graphics Studio and 3D Storm View are desktop-only', desc: 'Both were reachable on phones, where they exhaust memory and crash the app — the Studio decodes super-res radar in the browser and the 3D view renders a whole sweep in WebGL. They are now hidden on phones and tablets instead of being offered and failing.' },
            { title: 'National Radar: sharper, and no more flicker on zoom', desc: 'Two fixes. It now draws at your screen’s resolution and blends the data before choosing colours, so colour edges land crisply instead of being stretched and smeared — that was the real cause of the blur. And zooming no longer rebuilds the whole layer each time: the picture is updated in place and encoded off the main thread, so the flashing and stutter are gone.' },
            { title: 'National Radar is sharp when you zoom in', desc: 'It drew one picture of the whole country and stretched it to fit, so zooming into a county meant magnifying that picture about fifteen times — soft blobs however good the data was. It now draws just the part you are looking at, at the full 1 km detail the mosaic actually has, and redraws as you pan. Zoomed out to the whole country it looks exactly as it did.' },
            { title: 'National Radar uses your colortable', desc: 'The national radar coloured reflectivity from its own built-in table, so it never matched the single-site radar and an uploaded colortable changed one but not the other. It now reads the app’s own table — the same one the single-site radar uses — and repaints the moment you pick a different one.' },
            { title: 'National Radar honours smoothing', desc: 'The Smoothing setting governed the single-site radar but not the national mosaic, which stayed visibly blockier beside it. It now follows the setting: on, each pixel averages the area it covers instead of grabbing one cell, which removes the stair-stepping without softening storm cores; off, you get crisp cells.' },
            { title: 'National Radar was drawn ~150 miles too far north', desc: 'This is the big one. The MRMS mosaic was being stretched onto the map using the wrong projection, which slid every echo northward — by up to 150 miles through the middle latitudes. Storms off the Carolina coast were painted over Washington DC; rain in south Georgia showed over central Georgia. The data was always right; where it was drawn was not. Fixed, and now accurate to under a mile. Model overlays had the same fault, up to 80 miles on a nationwide view, and are fixed too.' },
            { title: 'National Radar', desc: 'The MRMS layer is now labelled for what it is — National Radar: one seamless observed picture of the whole country, built by NOAA from every WSR-88D, updating about every two minutes. Not a model and not a forecast. Its legend shows the frame time so you can always see how current it is.' },
            { title: 'You can see what a layer is showing you', desc: 'MRMS now carries a legend with the product, its colour scale, the frame’s time and how old it is — and says STALE outright if the feed stops. Model overlays say FORECAST with the model and valid time. A model composite reflectivity and a live national mosaic cover the same ground and look alike; nothing on screen used to tell you which one you were looking at.' },
            { title: 'MRMS is now 25 products, not one', desc: 'The MRMS layer showed a single field — base reflectivity — with no way to change it. It now has a product picker covering the national grids worth watching: four reflectivity fields, AzShear and rotation tracks for spotting couplets, MESH and POSH for hail, echo tops, VIL, VIL density and VII, precipitation rate and type, and radar-only and multi-sensor QPE out to 24 hours. Each has its own colour scale and units; reflectivity still uses your own colour table so it matches the single-site radar.' },
            { title: 'Dropdowns are readable', desc: 'Opening a dropdown showed a white sheet with near-white text on it — the list a select opens is drawn by the operating system, and it was ignoring the app’s dark theme. Every dropdown in the app now opens dark and legible, not just the ones on the sounding.' },
            { title: 'Forecast hours match the model', desc: 'The sounding offered the same lead times whatever model you picked, so half of them failed on the short-range ones. Each model now lists only hours it actually runs — hourly detail for the HRRR and NAM 3 km nest, out to 10 days on the GFS — and switching models keeps the hour you were on when the new one has it.' },
            { title: 'Real SHARPpy soundings', desc: 'The forecast sounding now renders the full SounderPy/SHARPpy analysis — the same plot the reference sites publish. Parcel traces for surface, mixed-layer and most-unstable parcels, the Bunkers hodograph with storm-motion vectors, the complete CAPE/CIN/LCL/shear/SRH tables, streamwiseness and storm-relative wind panels. Available on all five models.' },
            { title: 'Soundings on every model', desc: 'The forecast sounding was GFS-only. HRRR, NAM, the NAM 3 km nest and ECMWF are now all available from the model dropdown, out to the same lead times.' },
            { title: 'NAM winds were wrong — fixed', desc: 'Anywhere the NAM or NAM 3 km nest showed wind, it was reading the wrong half of the file: NOAA packs the east and north components into a single record, and both were decoding as the same one. Soundings showed impossible wind speeds. Wind, shear, storm motion and barbs on those two models are all corrected.' },
            { title: 'The sounding tells you what it is showing', desc: 'If the exact SHARPpy plot is unavailable on your server, the panel now says so underneath the built-in one — with the command to install it — instead of quietly drawing something that looks different.' },
            { title: 'Named QPF windows', desc: '3, 6, 12, 24, 48 and 120-hour precipitation totals ending at whichever forecast hour you are on. A window only appears once the run has gone far enough to compute it, so there is never a button that cannot work.' },
            { title: 'Wind barbs', desc: 'Wind at 10 m, 850, 500 and 250 mb drawn as proper barbs — pennants, full and half barbs, and an open circle for calm — so you can read direction as well as speed. A shaded map can only ever show you speed.' },
            { title: 'Anomalies', desc: 'Precipitable water and 2 m temperature as a departure from normal, against the 1981–2010 daily climatology for that forecast’s valid date. 25 mm of moisture is unremarkable on the Gulf coast and extraordinary over Montana; this is the map that tells them apart.' },
            { title: 'Combination plots', desc: 'Shaded field with wind barbs over it in one image — SBCAPE with surface barbs, MLCAPE with 0–6 km shear barbs, the Supercell Composite with shear barbs, MSLP, theta-e and 500 mb wind. Reading instability against the wind that will organise it is the whole point, and flipping between two overlays loses it.' },
            { title: 'HRRR forecast hours are correct', desc: 'A freshly started HRRR run listed forecast hours it had not produced yet — all 24 of the day’s runs share one folder and the scan was not separating them — so picking one of those hours failed. It now offers only what the run has actually posted.' },
            { title: 'A full product menu for the models', desc: 'Models & Forecast now has the whole forecast-desk product list, grouped the way you read it: Surface, Precipitation Type, Quantitative Precipitation, Integrated Moisture, Radar, Severe Weather (Instability, Wind Shear, Composite Parameters), Upper-Air Moisture and Dynamics, and Winter Weather. The HRRR carries 51 of them. Each model only shows what it actually has — no card that fails when you click it.' },
            { title: 'Computed severe parameters', desc: 'Fields that are not in the model file are now worked out from the ones that are: 0–6 km, 0–1 km and surface-to-500 mb bulk shear, 700–500 and 850–500 mb lapse rates, LCL and LFC height above ground, 2 m theta-e, EHI, the Supercell Composite, and precipitation type from the rain/snow/sleet/freezing-rain flags. Precipitation type gets a proper category legend rather than a colour bar.' },
            { title: 'ECMWF', desc: 'The ECMWF IFS at 0.25° joins the model list, out to 144 hours — 2 m temperature and dew point, 10 m wind and gusts, MSLP, QPF, cloud cover, precipitable water, MUCAPE, lapse rates, and upper-air winds, temperatures and humidity.' },
            { title: 'Precipitation rate actually shows up', desc: 'The Precipitation Rate field was drawing nothing at all — it is stored in units a thousand times smaller than the scale it was being coloured against, so every value fell off the bottom. It now plots in mm/hr.' },
            { title: 'NAM 3 km CONUS nest', desc: 'The NAM’s high-resolution 3 km CONUS nest joins the model list in Models & Forecast — hourly out to 60 hours, with the full severe set including MLCAPE, MUCAPE and 0–6 km shear at four times the detail of the 12 km NAM.' },
            { title: 'The NAM’s forecast hours are back', desc: 'Picking the NAM gave you a run with no forecast hours to step through. Its files share a folder with every other NAM product, and the listing was being cut off before reaching them. All 53 hours out to +84 are there again.' },
            { title: 'CAPE and shear in Models & Forecast', desc: 'Six new quick fields for severe setups: MLCAPE and MUCAPE alongside the existing surface CAPE, 0–6 km and 0–1 km bulk shear, and 0–3 km and 0–1 km storm-relative helicity. Bulk shear is computed from the model’s wind-shear components and drawn in knots, so you get the number you actually forecast off rather than two raw component fields. Each card only appears on the models that carry it — HRRR has all six, the NAM and GFS a subset.' },
            { title: 'Cameras & More is one section', desc: 'The menu’s Cameras and More groups are now a single “Cameras & More” section — Live Cameras, Live Cams, BuoyCAMs, Earthquakes, NOAA Weather Radio and Power Outages together, one heading to open instead of two.' },
            { title: 'Drawings show on both panes', desc: 'Mark up a storm in split screen and the same mark appears on the other pane, over the same ground. Draw on either side — it copies to the other. Turn split screen off and the copy goes away, leaving what you actually drew.' },
            { title: 'Split screen works like you’d expect', desc: 'Click a pane to select it, then pick from the product menu you already use — that pane changes, the other one stays put. So you can hold reflectivity on the left and flip the right through velocity, correlation coefficient and back without losing your place. The separate right-pane control box is gone; there is one set of controls now, and a highlight around the edge of a pane shows which map you are driving.' },
            { title: 'Both panes wear the Vortex map', desc: 'The second pane now uses the same basemap as the first, instead of opening as a stock dark Mapbox map beside it. Both panes share whichever radar site you pick on the left, so the comparison is always the same storm.' },
        ],
    },
    {
        date: 'August 28, 2026',
        items: [
            { title: 'Shift+V for velocity', desc: 'Press Shift+V to jump straight to velocity and Shift+R to go back to reflectivity, without opening the product menu. Works on WSR-88D, TDWR and Level 2 — it picks the right product for whichever radar you are on. Press ? for the full shortcut list.' },
            { title: 'Severe, Tropical and Fire settings', desc: 'The settings menu now has three dedicated screens under Tools — Severe, Tropical and Fire — instead of one SPC Outlooks page. Severe keeps the convective outlooks, Tropical gathers the NHC layers (hurricanes, spaghetti models, hurricane hunters, Atlantic and E Pacific tracks), and Fire brings the fire weather layers and SPC fire outlooks together in one place.' },
            { title: 'Live wildfire perimeters', desc: 'Two new Fire layers show what is actually burning: Fire Perimeters draws the burned area shaded by how contained it is, and Active Fires plots incidents sized by acreage. Tap either for acres, containment, cause and when it was first reported. Data from the interagency NIFC feeds, refreshed every few minutes.' },
            { title: 'Station plot shows dew point', desc: 'The METAR station layer now plots dew point rather than temperature — the field that actually tells you whether there is moisture to work with, and one that does not swing with afternoon heating. Tap a station for the full observation, temperature included.' },
            { title: 'The bottom bar folds away', desc: 'A handle on the left of the bar folds it down to nothing but that handle, so you can see the whole map on a smaller screen. It remembers whether you left it open or closed.' },
            { title: 'SPC Fire Weather outlooks', desc: 'SPC Outlooks now include Fire Weather for Day 1 and Day 2 — Dry Thunderstorms and Wind &amp; Relative Humidity — alongside the convective outlooks, drawn in SPC&rsquo;s own colours.' },
            { title: 'Panels scroll on smaller screens', desc: 'Models &amp; Forecast and the other side panels now scroll properly. On a laptop — or any short window — the lower part of a panel used to be cut off with no way to reach it, so Quick Fields ran off the bottom and “All variables” could not be opened at all. Short screens also get a little more room and tighter spacing.' },
            { title: 'EOC Mode', desc: 'A new emergency-operations board at /eoc — a different interface built for running an incident rather than watching the weather. Active warnings sorted by what matters first, a live population-affected count resolved from the actual counties each warning covers, field reports arriving as they’re filed, spotters, storm tracks, power outages, PTT and cameras, plus hospitals, schools and shelters for wherever you’ve got the map. Confirmed tornado warnings and catastrophic damage threats are called out on sight.' },
            { title: 'Live Radar in Graphics Studio', desc: 'A new Studio template with a map you can actually move — drag to pan, scroll to zoom, and compose the shot directly instead of picking a region from a list. The radar is the app’s own super-res Level 2, decoded right in your browser with the same decoder and the same colortables as the radar page, so a graphic and the live radar agree gate for gate. Pick any WSR-88D, or let it follow whichever radar you were just watching.' },
            { title: 'Radar loops in the Studio', desc: 'Press Play to loop the last several scans for the site on screen and watch storm motion without leaving the Studio. Frames are prepared before the loop starts, so it plays smoothly instead of stuttering on its first pass.' },
            { title: 'Live button', desc: 'Jump straight back to the newest scan from anywhere in a loop. It lights up whenever you’re on current data, so at a glance you can tell live radar from loop history.' },
            { title: 'Smoother panning', desc: 'Moving the map is much faster, and the radar no longer disappears while you drag it.' },
        ],
    },
    {
        date: 'July 29, 2026',
        items: [
            { title: 'Wind Particles', desc: 'A new velocity-flow overlay — animated particles stream along the radar velocity field and swirl around storm rotation, so you can read a storm’s motion at a glance. Works over any product and follows the tilt you’re viewing.' },
            { title: 'Filtered Active Alerts list', desc: 'The Active Alerts list now respects your alert filters — warning types you’ve turned off no longer show up in the list either, so you only scroll through the alerts you actually want to see.' },
        ],
    },
    {
        date: 'July 20, 2026',
        items: [
            { title: 'GOES-19 Clean IR satellite', desc: 'New satellite layer — GOES-19 (GOES-East) Clean Longwave Infrared. Clear skies stay transparent so the map still shows through, while cloud tops brighten with how cold (and tall) they are. Updates every 5 minutes.' },
            { title: 'NHC Hurricanes', desc: 'Full National Hurricane Center overlay: the live storm marker (category icon + name), forecast cone and track, past track, initial wind field, and areas of possible development — tap the storm for its wind, pressure, movement and headline.' },
            { title: 'Spaghetti Models', desc: 'Model track guidance — GFS, UKMET, CMC, NAVGEM, HWRF, HMON, HAFS-A/B, plus the NHC official track and consensus — drawn from NHC a-deck data as its own toggle.' },
            { title: 'Hurricane Hunters', desc: 'Live NOAA and USAF recon aircraft positions, plus the latest reconnaissance flight track with flight-level and surface (SFMR) wind observations.' },
            { title: 'Manual Storm Track Tool', desc: 'Drag on the map in a storm’s direction of motion, enter its speed, and get a projected path (cellular or linear) with estimated arrival times for the communities in its way.' },
            { title: 'More accurate field reports', desc: 'Weather report locations are far more reliable: GPS now refines to its best fix and shows its accuracy, and you can drop and drag a pin to your exact spot — a big help on hotspots and laptops where GPS is coarse.' },
            { title: 'Password help', desc: 'Forgot-password now opens a support ticket, admins can reset any user’s password from the app, and after a reset you’re prompted to choose your own new password at sign-in.' },
            { title: 'Live Cams cleanup', desc: 'Trimmed the camera list to keep feeds streamlined.' },
        ],
    },
];

$('#armrChangelogBtn').click(function () {
    const accent = 'var(--vx-accent)';
    const text = 'rgb(225, 230, 237)';
    const muted = 'rgb(150, 158, 168)';

    const releases = CHANGELOG.map((rel) => {
        const items = rel.items.map((it) => (
            `<div style="margin: 0 0 12px;">
                <div style="font-weight: 700; color: ${text}; font-size: 15px;">${it.title}</div>
                <div style="font-size: 13.5px; color: ${muted}; line-height: 1.5; margin-top: 2px;">${it.desc}</div>
            </div>`
        )).join('');
        return (
            `<div style="margin: 6px 0 14px;">
                <div style="margin: 6px 0 12px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: ${accent}; font-weight: 700;">${rel.date}</div>
                ${items}
            </div>`
        );
    }).join('');

    const html_content =
`<div style="text-align: left; padding: 4px 20px; color: ${text};">
<p style="margin: 0 0 6px; color: ${muted};">The latest additions and improvements to Vortex Radar.</p>
${releases}
<p style="margin: 14px 0 0; font-size: 12px; color: ${muted};">© 2026 Twistcaster Live Media LLC.</p>
</div>`;

    display_vortex_dialog({
        'title': "What's New",
        'body': html_content,
        'color': 'rgb(230, 230, 230)',
        'textColor': 'black',
    });
});

module.exports = {};
