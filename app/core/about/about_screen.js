const display_vortex_dialog = require('../menu/vortex_dialog');

$('#armrAboutBtn').click(function() {
    const accent = 'var(--vx-accent)';
    const text = 'rgb(225, 230, 237)';
    const muted = 'rgb(150, 158, 168)';
    function person(name, location) {
        return `<div style="margin-bottom: 8px;"><b style="color: ${text};">${name}</b><br><span style="font-size: 13px; color: ${muted};">${location}</span></div>`;
    }
    function heading(text) {
        return `<div style="margin: 18px 0 8px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: ${accent}; font-weight: 700;">${text}</div>`;
    }

    const html_content =
`<div style="text-align: left; padding: 4px 20px; color: ${text};">
<p style="margin: 0 0 4px; color: ${muted};">Meet the storm chasers, meteorologists, and media professionals behind Twistcaster Live Media.</p>

${heading('The Team')}
${person('David Wallis', 'Cumming, GA')}
${person('Nick Smego', 'Denver, CO')}
${person('Nick Carter', 'Woodstock, GA')}
${person('Melissa Womack', 'Odessa, TX')}
${person('Jeff Eschenbacher', 'Tulsa, OK')}
${person('Steven Jones', 'Norman, OK')}
${person('Joseph Pisani', 'Atlanta, GA')}
${person('Candace Pisani', 'Atlanta, GA')}
${person('Dan Klawien', 'Elkhorn, WI')}
${person('Rob Salso', 'Brandon, FL')}

${heading('SpotterNetwork Integration')}
<p style="margin: 0; font-size: 14px;">Our team uses SpotterNetwork to share real-time position data during active weather events. All spotters are registered with unique callsigns and follow NWS reporting protocols.</p>

${heading('Contact')}
<p style="margin: 0; font-size: 14px;">For media inquiries, collaboration opportunities, or SpotterNetwork coordination, reach out via your preferred contact method.</p>

<p style="margin: 18px 0 0; font-size: 12px; color: ${muted};">© 2026 Twistcaster Live Media LLC. All rights reserved.</p>
</div>`;

    display_vortex_dialog({
        'title': 'Our Team',
        'body': html_content,
        'color': 'rgb(230, 230, 230)',
        'textColor': 'black',
    })
})
