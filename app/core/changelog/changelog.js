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
