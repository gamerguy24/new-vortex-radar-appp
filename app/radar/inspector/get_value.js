const turf = require('@turf/turf');
const format_value = require('./format_value');
const product_colors = require('../colormaps/colormaps');
const map = require('../../core/map/map');

/*
 * Beam height above radar level, in feet, for a gate this far from the radar
 * on this elevation angle (4/3-earth model; ERAU Doppler formulas).
 */
function beam_height_ft(distance_km, elevation_angle) {
    const earthRadius = 6374; // km
    const k = (4 / 3) * earthRadius;
    const rad = Math.PI / 180;
    const arl_km = Math.sqrt(distance_km * distance_km + k * k + 2 * distance_km * k * Math.sin(elevation_angle * rad)) - k;
    return arl_km * 3280.8;
}

function read_pixel(gl, x, y) {
    const data = new Uint8Array(4);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return data;
}

/*
 * What the radar shows at a screen point (CSS pixels, relative to the map
 * canvas). plot_to_map renders each gate's value, encoded as RGBA, into an
 * off-screen framebuffer (window.vortexData.fb) while the inspector is on;
 * this reads one pixel of it back and decodes it.
 *
 * Returns { value: '52.5 dBZ' | 'Range Folded' | null, color, beam_ft, lngLat },
 * or null when there is no radar on the map yet.
 */
function value_at(point) {
    const S = window.vortexData;
    const canvas = map.getCanvas();
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl || !S || !S.fb || S.cmin == undefined) return null;

    const cssW = canvas.clientWidth || parseFloat(canvas.style.width);
    const cssH = canvas.clientHeight || parseFloat(canvas.style.height);
    // The WebGL buffer is device pixels, origin bottom-left.
    const bx = Math.round(gl.drawingBufferWidth / cssW * point.x);
    const by = Math.round(gl.drawingBufferHeight / cssH * (cssH - point.y));
    if (bx < 0 || by < 0 || bx >= gl.drawingBufferWidth || by >= gl.drawingBufferHeight) return null;

    gl.bindFramebuffer(gl.FRAMEBUFFER, S.fb);
    const encoded = read_pixel(gl, bx, by);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const [value, orig_value] = format_value.decode_and_format(encoded, S.cmin, S.cmax);
    let color = null;
    if (value === 'Range Folded') color = product_colors.range_folded;
    else if (value != null && S.webgl_chroma_scale) {
        const [r, g, b, a] = S.webgl_chroma_scale(parseFloat(orig_value)).rgba();
        color = `rgba(${r}, ${g}, ${b}, ${a})`;
    }

    const lngLat = map.unproject([point.x, point.y]);
    let beam_ft = null;
    const radar = S.current_nexrad_location;
    if (radar != undefined && S.current_elevation_angle != undefined) {
        const km = turf.distance(turf.point([lngLat.lng, lngLat.lat]), turf.point([radar[1], radar[0]]), { units: 'kilometers' });
        beam_ft = beam_height_ft(km, S.current_elevation_angle);
    }
    return { value, color, beam_ft, lngLat };
}

/*
 * The fixed centre crosshair (touch screens, which cannot hover): read the
 * value under the middle of the map and point the red line at the radar.
 */
function update_crosshair() {
    const c = map.project(map.getCenter());
    const out = value_at(c);
    if (!out) { $('#colorPickerText').hide(); return; }
    if (out.value == null) $('#colorPickerText').hide();
    else { $('#colorPickerText').show(); $('#colorPickerTextValue').text(out.value); }
    if (out.color) $('#colorPicker').css('background-color', out.color);
    $('#colorPickerTextBeamHeight').text(out.beam_ft != null ? `${out.beam_ft.toFixed(0)} ft ARL` : '');

    const radar = window.vortexData.current_nexrad_location;
    if (radar != undefined) {
        const centre = map.getCenter();
        const bearing = turf.bearing(turf.point([centre.lng, centre.lat]), turf.point([radar[1], radar[0]]));
        $('#radarCenterLine').css('transform', `rotate(${bearing}deg)`);
    }
}

module.exports = { value_at, update_crosshair };
