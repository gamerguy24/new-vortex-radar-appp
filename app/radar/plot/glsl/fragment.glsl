precision highp float;
uniform vec2 minmax;
uniform float u_gateFilter;
uniform sampler2D u_texture;
varying float color;

void main() {
    // Reflectivity gate filter: hide gates below the threshold (dBZ).
    if (color < u_gateFilter) discard;
    float calcolor = (color - minmax.x) / (minmax.y - minmax.x);
    gl_FragColor = texture2D(u_texture, vec2(min(max(calcolor, 0.0), 1.0), 0.0));
}