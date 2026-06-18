/*
 * components/palettes.js
 * Minimal palette provider for the MRMS layer. Exposes a standard NWS
 * reflectivity (REF) color table as [value, 'rgb(...)', value, 'rgb(...)', ...].
 * The MRMS layer falls back to REF when no dedicated MRMS_REF table is present.
 */

const REF = [
    5,  'rgb(4, 233, 231)',
    10, 'rgb(1, 159, 244)',
    15, 'rgb(3, 0, 244)',
    20, 'rgb(2, 253, 2)',
    25, 'rgb(1, 197, 1)',
    30, 'rgb(0, 142, 0)',
    35, 'rgb(253, 248, 2)',
    40, 'rgb(229, 188, 0)',
    45, 'rgb(253, 149, 0)',
    50, 'rgb(253, 0, 0)',
    55, 'rgb(212, 0, 0)',
    60, 'rgb(188, 0, 0)',
    65, 'rgb(248, 0, 253)',
    70, 'rgb(152, 84, 198)',
    75, 'rgb(255, 255, 255)',
];

export default class Palettes {
    constructor() {
        this.palettes = { REF };
    }
    getPalette(name) {
        return this.palettes[name] || this.palettes.REF;
    }
}
