import Dialog from "../js/ui/dialog.js";

/*
 * Sponsors.
 *
 * The named sponsors were removed at the owner's request; this is now only the
 * invitation and the address to write to. Keeping the dialog (rather than
 * dropping the menu item) means the door is still visible to anyone looking for
 * it, and adding sponsors back later is just markup.
 */
const SPONSOR_EMAIL = 'admin@extremeweathervideos.com';

export default function openSponsors() {
    const content = `
        <div style="text-align: center; padding: 8px 4px 4px;">
            <div style="
                width: 56px; height: 56px; margin: 0 auto 16px;
                background: var(--vx-accent-soft);
                border-radius: var(--vx-r-3);
                display: flex; align-items: center; justify-content: center;
            ">
                <i class="ti ti-star" style="font-size: 1.8em; color: var(--primary-color, var(--vx-accent));"></i>
            </div>

            <p style="margin: 0 0 6px; font-size: 15px; font-weight: 600;">
                Interested in sponsoring Echo Radar?
            </p>
            <p style="margin: 0 0 18px; font-size: 13px; color: var(--text-muted, var(--vx-text-2)); line-height: 1.5;">
                Sponsorship helps keep the radar free for everyone.
                Get in touch and we will send you the details.
            </p>

            <a href="mailto:${SPONSOR_EMAIL}" style="
                display: inline-flex; align-items: center; gap: 8px;
                padding: 11px 18px;
                border-radius: var(--vx-r-3);
                background: var(--vx-accent-soft);
                border: 1px solid var(--border-color, gray);
                color: var(--primary-color, var(--vx-accent));
                font-size: 14px; font-weight: 600;
                text-decoration: none;
                word-break: break-all;
            ">
                <i class="ti ti-mail"></i> ${SPONSOR_EMAIL}
            </a>
        </div>
    `;

    new Dialog('Sponsors', 'star', content, {}, true);
}
