import Dialog from "../js/ui/dialog.js";

export default function openSponsors() {
    const content = `
        <p style="margin-bottom: 20px; color: var(--text-muted, var(--vx-text-2));">
            Vortex Radar is made possible by the generous support of our sponsors.
            Thank you for keeping this platform free for everyone.
        </p>

        <div style="display: flex; flex-direction: column; gap: 16px;">

            <div style="
                background: rgba(255,255,255,0.04);
                border: 1px solid var(--border-color, gray);
                border-radius:var(--vx-r-3);
                padding: 18px 20px;
                display: flex;
                align-items: center;
                gap: 16px;
            ">
                <div style="
                    width: 48px; height: 48px;
                    background: var(--vx-accent-soft);
                    border-radius:var(--vx-r-3);
                    display: flex; align-items: center; justify-content: center;
                    flex-shrink: 0;
                ">
                    <i class="ti ti-radio" style="font-size: 1.6em; color: var(--primary-color, var(--vx-accent));"></i>
                </div>
                <div>
                    <div style="font-weight: 700; font-size: 15px; margin-bottom: 4px;">Global PTT</div>
                    <div style="font-size: 13px; color: var(--text-muted, var(--vx-text-2)); margin-bottom: 8px;">
                        Push-to-talk communication solutions for first responders, storm chasers, and emergency teams worldwide.
                    </div>
                    <a href="https://www.tiktok.com/@globalptt?_r=1&_t=ZP-92uLt6rrOpy" target="_blank" style="
                        font-size: 12px;
                        color: var(--primary-color, var(--vx-accent));
                        text-decoration: none;
                        display: inline-flex;
                        align-items: center;
                        gap: 4px;
                    ">
                        <i class="ti ti-external-link"></i> @globalptt
                    </a>
                </div>
            </div>

            <div style="
                background: rgba(255,255,255,0.04);
                border: 1px solid var(--border-color, gray);
                border-radius:var(--vx-r-3);
                padding: 18px 20px;
                display: flex;
                align-items: center;
                gap: 16px;
            ">
                <div style="
                    width: 48px; height: 48px;
                    background: var(--vx-accent-soft);
                    border-radius:var(--vx-r-3);
                    display: flex; align-items: center; justify-content: center;
                    flex-shrink: 0;
                ">
                    <i class="ti ti-heart" style="font-size: 1.6em; color: var(--primary-color, var(--vx-accent));"></i>
                </div>
                <div>
                    <div style="font-weight: 700; font-size: 15px; margin-bottom: 4px;">By His Grace</div>
                    <div style="font-size: 13px; color: var(--text-muted, var(--vx-text-2)); margin-bottom: 8px;">
                        Proudly supporting Vortex Radar and the mission to keep communities safe through better weather awareness.
                    </div>
                </div>
            </div>

        </div>

        <p style="margin-top: 20px; font-size: 12px; color: var(--text-muted, var(--vx-text-2)); text-align: center;">
            Interested in sponsoring? Contact us at
            <a href="mailto:admin@twistcasterlivemedia.com" style="color: var(--primary-color, var(--vx-accent));">admin@twistcasterlivemedia.com</a>
        </p>
    `;

    new Dialog('Sponsors', 'star', content, {}, true);
}
