/*
 * js/ui/dialog.js
 * Lightweight modal dialog used by the Vortex Radar feature layers
 * (Sponsors, Live Cams, Report Weather, ...). ES module, no dependencies
 * beyond Tabler icons (already loaded in index.html).
 *
 *   new Dialog(title, icon, contentHtml, opts = {}, _legacy = true)
 *   dialog.close()
 */

let stylesInjected = false;
function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    const s = document.createElement('style');
    s.textContent = `
.vr-dialog-bg {
    position: fixed; inset: 0; z-index: 100000;
    background: rgba(4, 8, 16, 0.72);
    backdrop-filter: blur(6px);
    display: flex; align-items: flex-start; justify-content: center;
    overflow: auto; padding: 32px 16px;
    opacity: 0; transition: opacity 0.15s ease;
    --primary-color: #27beff;
    --border-color: rgba(255,255,255,0.12);
    --text-muted: #9ca3af;
    font-family: 'Onest', system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.vr-dialog-bg.show { opacity: 1; }
.vr-dialog {
    width: min(560px, 96vw);
    max-height: 86vh;
    display: flex; flex-direction: column;
    background: rgba(11, 18, 32, 0.97);
    border: 1px solid var(--border-color);
    border-radius: 16px;
    box-shadow: 0 24px 70px rgba(0,0,0,0.55);
    color: #e7eef7;
    overflow: hidden;
}
.vr-dialog-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 18px; border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
}
.vr-dialog-header h2 {
    margin: 0; font-size: 1.2em; display: flex; align-items: center; gap: 8px;
}
.vr-dialog-header h2 .ti { color: var(--primary-color); }
.vr-dialog-close {
    background: rgba(0,0,0,0.4); color: #fff; cursor: pointer;
    border: 1px solid var(--border-color); border-radius: 8px;
    width: 32px; height: 32px; font-size: 1.05em; line-height: 1;
    display: inline-flex; align-items: center; justify-content: center;
}
.vr-dialog-close:hover { background: rgba(255,255,255,0.08); }
.vr-dialog-body { padding: 18px; overflow: auto; }
`;
    document.head.appendChild(s);
}

export default class Dialog {
    constructor(title, icon, contentHtml, opts = {}, _legacy = true) {
        injectStyles();
        this.opts = opts || {};

        this.overlay = document.createElement('div');
        this.overlay.className = 'vr-dialog-bg';
        this.overlay.innerHTML = `
            <div class="vr-dialog" role="dialog" aria-modal="true">
                <div class="vr-dialog-header">
                    <h2>${icon ? `<i class="ti ti-${icon}"></i> ` : ''}${title}</h2>
                    <button class="vr-dialog-close" title="Close"><i class="ti ti-x"></i></button>
                </div>
                <div class="vr-dialog-body"></div>
            </div>`;
        this.body = this.overlay.querySelector('.vr-dialog-body');
        this.body.innerHTML = contentHtml;

        document.body.appendChild(this.overlay);

        this.overlay.querySelector('.vr-dialog-close').addEventListener('click', () => this.close());
        this.overlay.addEventListener('click', (e) => { if (e.target === this.overlay) this.close(); });
        this._onKey = (e) => { if (e.key === 'Escape') this.close(); };
        document.addEventListener('keydown', this._onKey);

        requestAnimationFrame(() => this.overlay.classList.add('show'));
    }

    close() {
        document.removeEventListener('keydown', this._onKey);
        if (this.overlay && this.overlay.parentNode) this.overlay.remove();
    }
}
