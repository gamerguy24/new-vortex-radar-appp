/*
 * changelog.js
 * "What's New" screen — a running list of user-facing additions so users can see
 * what's changed. To add a release, unshift a new entry onto CHANGELOG (newest
 * first); each item is a { title, desc } feature line.
 */

const display_attic_dialog = require('../menu/attic_dialog');

const CHANGELOG = [
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
    const accent = '#27beff';
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

    display_attic_dialog({
        'title': "What's New",
        'body': html_content,
        'color': 'rgb(230, 230, 230)',
        'textColor': 'black',
    });
});

module.exports = {};
