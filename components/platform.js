/*
 * components/platform.js
 * Which device is this, for features that genuinely cannot run everywhere.
 *
 * Used to gate the heavyweight desktop tools — the Graphics Studio, which
 * decodes super-res Level 2 in the browser, and the 3D storm view, which
 * volume-renders a full sweep. Both routinely exhaust a phone's memory and
 * take the tab, sometimes the phone, down with them.
 *
 * Hiding them is kinder than letting them be tapped and crash. A feature that
 * is absent is a limitation; one that is present and kills the app is a fault.
 */

/**
 * A desktop-class machine: a real pointer and a window big enough for the tool.
 *
 * Deliberately capability-based rather than a user-agent sniff. A Windows
 * tablet in tablet mode and an Android phone have the same problem — a coarse
 * pointer and a small screen — and neither should be offered a tool built for
 * a mouse and a large canvas. Reading the user agent instead would pass the
 * tablet and fail a desktop browser in device-emulation mode.
 */
function isDesktop() {
    if (typeof window === 'undefined') return false;
    try {
        const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
        const smallish = window.innerWidth < 900;
        // Touch alone is not disqualifying — plenty of desktop screens have it.
        return !coarse && !smallish;
    } catch (e) {
        return true;   // if we cannot tell, do not take a working feature away
    }
}

/**
 * Windows specifically.
 *
 * Kept separate from isDesktop() on purpose: the tools are gated on CAPABILITY,
 * not on brand, so a desktop Mac or Linux user keeps them. If a tool ever needs
 * to be Windows-only for a real reason — a native dependency, say — use this.
 */
function isWindows() {
    if (typeof navigator === 'undefined') return false;
    const p = (navigator.userAgentData && navigator.userAgentData.platform)
        || navigator.platform || navigator.userAgent || '';
    return /win/i.test(p);
}

/**
 * Hide an element and stop it being reachable.
 *
 * `hidden` alone loses to a stylesheet that sets display, so the inline style
 * goes on too, and pointer-events guards against anything that un-hides it.
 */
function hideElement(el) {
    if (!el) return;
    el.hidden = true;
    el.style.display = 'none';
    el.style.pointerEvents = 'none';
    el.setAttribute('aria-hidden', 'true');
}

/**
 * Gate a feature to desktop: hide its entry points and report whether it ran.
 * Returns true when the feature should stay enabled.
 */
function desktopOnly(selectors, featureName) {
    if (isDesktop()) return true;
    for (const sel of selectors) {
        document.querySelectorAll(sel).forEach(hideElement);
    }
    console.log('[platform] ' + featureName + ' is desktop-only; hidden on this device.');
    return false;
}

export { isDesktop, isWindows, hideElement, desktopOnly };
