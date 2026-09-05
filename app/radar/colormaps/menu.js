const product_colors = require('./colormaps');
const colortable_parser = require('./colortable_parser');

function create_css_gradient(colors, values) {
    const cmax = values[values.length - 1];
    const cmin = values[0];
    const clen = colors.length;

    var gradient_colors = '';
    for (var i = 0; i < clen; ++i) {
        var cur_percent = (((values[i] - cmin) / (cmax - cmin)) * 100);
        gradient_colors += `${colors[i]} ${cur_percent}%`;
        if (!(i == clen - 1)) { gradient_colors += ',\n' }
    }

    return gradient_colors;
}

const lookup = {
    'REF': ['REF', 'N0B', 'N1B', 'N2B', 'N3B', 'TZL', 'TZ0', 'TZ1', 'TZ2', 'TZ3'],
    'VEL': ['VEL', 'N0G', 'N1G', 'N2G', 'N3G', 'NAG', 'NBG', 'N0U', 'N1U', 'N2U', 'N3U', 'TV0', 'TV1', 'TV2'],
    'RHO': ['RHO', 'N0C', 'N1C', 'N2C', 'N3C'],
    'ZDR': ['ZDR', 'N0X', 'N1X', 'N2X', 'N3X'],
    'KDP': ['N0K', 'N1K', 'N2K', 'N3K'],
    'DVL': ['DVL']
}
const ctables = [
    'REF1', 'REF2', 'REF3', 'REF4', 'REF5',
    'VEL1', 'VEL2',
    'RHO1',
    'ZDR1',
    'KDP1',
    'DVL1',
];

// ── persistence: remember each viewer's colortable picks + uploads ───────────
// Stored per-browser in localStorage so a chosen colortable (and any uploaded
// ones) survive a refresh instead of snapping back to Default.
const CHOICE_KEY = 'vortexColortableChoice';   // { REF:'REF2', VEL:'VEL1', … }
const CUSTOM_KEY = 'vortexCustomColortables';   // [{ id, text }]
function _loadChoices() { try { return JSON.parse(localStorage.getItem(CHOICE_KEY)) || {}; } catch (e) { return {}; } }
function _saveChoice(group, id) { try { const c = _loadChoices(); c[group] = id; localStorage.setItem(CHOICE_KEY, JSON.stringify(c)); } catch (e) {} }
function _loadCustom() { try { return JSON.parse(localStorage.getItem(CUSTOM_KEY)) || []; } catch (e) { return []; } }
function _saveCustom(list) { try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)); } catch (e) {} }
function _rememberCustom(id, text) { const l = _loadCustom(); if (!l.some((e) => e.id === id)) { l.push({ id, text }); _saveCustom(l); } }

// Register an uploaded colortable: add its menu row (if missing), parse it, and
// list it so previews + selection work. Shared by upload and restore-on-load.
function registerUploaded(id, colortable_string, label) {
    const group = id.slice(0, 3);
    const section = document.getElementById(`${group}_ctable_options`);
    if (section && !document.getElementById(`armr${id}ColortableBtn`)) {
        section.insertAdjacentHTML('beforeend',
`<div class="vortexRadarMenuRow colortableRow armrWide armrBottom" id="armr${id}ColortableBtn" name="${id}">
<span class="colortable_menu_text">${label || 'User Upload'}</span>
<div class="colortable_menu_image_preview" id="${id}_colortable_preview"></div>
</div>`);
    }
    product_colors[id] = colortable_parser(colortable_string, false);
    if (!ctables.includes(id)) ctables.push(id);
}

function _generate_images() {
    for (var product of ctables) {
        const css_gradient = create_css_gradient(product_colors[product].colors, product_colors[product].values);
        $(`#${product}_colortable_preview`).css({ background: `linear-gradient(to right, ${css_gradient})`});
    }
}
_generate_images();

const check = '<span class="colortable_menu_check"><i class="fa fa-circle-check icon-blue"></i></span>';
$(document).on('click', '.colortableRow', function() {
    const current_row_checked = $(this).find('.colortable_menu_check').length == 1;

    if (!current_row_checked) {
        $(this).parent().find('.colortable_menu_check').remove();

        const orig_html = $(this).html();
        $(this).html(`${check}${orig_html}`);

        const this_ctable_name = $(this).attr('name');
        change_colortable(this_ctable_name.slice(0, 3), this_ctable_name);
    }
})

$('.colortable_upload_btn').click(function() {
    const name = $(this).attr('name');
    const matches = ctables.filter(item => item.startsWith(name)).map(item => parseInt(item.slice(-1)));
    const next_num = matches[matches.length - 1] + 1;
    window.vortexData.next_ctable_id = `${name}${next_num}`;

    $('#hidden_colortable_file_uploader').click();
})
$('#hidden_colortable_file_uploader').on('input', () => {
    var files = document.getElementById('hidden_colortable_file_uploader').files;
    const uploaded_file = files[0];

    const reader = new FileReader();
    reader.addEventListener('load', function () {
        const colortable_string = Buffer.from(this.result).toString('utf-8');
        const id = window.vortexData.next_ctable_id;
        registerUploaded(id, colortable_string, 'User Upload');
        _rememberCustom(id, colortable_string);   // persist so it survives refresh
        _generate_images();
    }, false);
    reader.readAsArrayBuffer(uploaded_file);
})

function change_colortable(product, new_ctable) {
    const src = product_colors[new_ctable];
    const colors = src.colors;
    const values = src.values;

    const all_to_change = lookup[product];
    for (var cur_product of all_to_change) {
        product_colors[cur_product].colors = colors;
        product_colors[cur_product].values = values;
        // Keep the range-fold in sync with the picked table so a stale one from
        // a previous selection never leaks into the newly-chosen colortable.
        if (Object.prototype.hasOwnProperty.call(src, 'range_fold')) {
            product_colors[cur_product].range_fold = src.range_fold;
        } else {
            delete product_colors[cur_product].range_fold;
        }
    }

    _saveChoice(product, new_ctable);   // remember this pick across refreshes

    /*
     * Announce the change so layers outside this bundle repaint. The national
     * radar has listened for 'paletteUpdated' since it was written, but nothing
     * had ever dispatched it, so MRMS kept whatever colours it started with.
     */
    try {
        document.dispatchEvent(new CustomEvent('paletteUpdated', {
            detail: { paletteName: product, colortable: new_ctable },
        }));
    } catch (e) { /* cosmetic; never worth breaking a colortable change over */ }

    var a_d = window.vortexData;
    if (a_d?.nexrad_factory != undefined) {
        if (a_d.nexrad_factory.nexrad_level == 3) {
            a_d.nexrad_factory.plot();
        } else {
            a_d.nexrad_factory.plot(a_d.nexrad_factory_moment, a_d.nexrad_factory_elevation_number);
        }
    }
}

// ── restore each viewer's saved uploads + picks on load ──────────────────────
// Runs once at startup (before radar is plotted, so no redraw needed): re-adds
// uploaded colortables, then applies each saved per-product choice and moves the
// checkmark to it. Wrapped so a bad/stale entry can never break the menu.
(function restoreSavedColortables() {
    try {
        for (const e of _loadCustom()) {
            try { registerUploaded(e.id, e.text, 'User Upload'); } catch (err) {}
        }
        _generate_images();
        const choices = _loadChoices();
        for (const group of Object.keys(choices)) {
            const id = choices[group];
            if (!lookup[group] || !product_colors[id]) continue;   // skip stale/unknown
            change_colortable(group, id);
            const row = document.querySelector(`.colortableRow[name="${id}"]`);
            if (row && row.parentElement) {
                row.parentElement.querySelectorAll('.colortable_menu_check').forEach((el) => el.remove());
                row.insertAdjacentHTML('afterbegin', check);
            }
        }
    } catch (e) { /* never let restore break the menu */ }
})();