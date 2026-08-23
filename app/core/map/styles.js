const map = require('./map');
const set_layer_order = require('./setLayerOrder');
const map_funcs = require('./mapFunctions');

function change_map_style(style) {
    // const base_url = 'mapbox://styles/mapbox/';

    // const current_map_layers = map.getStyle().layers;
    // const original_sources = map.getStyle().sources;
    // const current_map_sources = Object.keys(original_sources).map(key => ({
    //     id: key,
    //     ...original_sources[key],
    // }));
    // const user_added_layers = current_map_layers.slice(1).slice(-(current_map_layers.length - window.vortexData.original_map_layers));
    // const user_added_sources = current_map_sources.slice(1).slice(-(current_map_sources.length - window.vortexData.original_map_sources));

    // if (style == 'satellite') {
    //     map.setStyle(base_url + 'satellite-streets-v12');
    // }

    // map.on('style.load', () => {
    //     for (var i = 0; i < user_added_sources.length; i++) {
    //         console.log(user_added_sources[i].id)
    //         map.addSource(user_added_sources[i].id, user_added_sources[i]);
    //     }
    //     for (var i = 0; i < user_added_layers.length; i++) {
    //         map.addLayer(user_added_layers[i]);
    //     }

    //     set_layer_order();
    // })

    if (window.vortexData.default_styles == undefined) {
        window.vortexData.default_styles = {
            'land': map.getPaintProperty('land', 'background-color'),
            'national_park': map.getPaintProperty('national-park', 'fill-color'),
            'landuse': map.getPaintProperty('landuse', 'fill-color'),
            'water': map.getPaintProperty('water', 'fill-color'),
        }
    }

    function set_dark() {
        // Use the Vortex Radar deep-navy theme rather than the style's original
        // (RadarScope-like) gray defaults.
        require('./vortex_basemap').apply_vortex_basemap();
    }
    function set_light() {
        const white = 'rgb(246, 244, 237)';
        const blue = 'rgb(136, 190, 227)';

        map.setPaintProperty('land', 'background-color', white);
        map.setPaintProperty('national-park', 'fill-color', white);
        map.setPaintProperty('landuse', 'fill-color', white);
        map.setPaintProperty('water', 'fill-color', blue);
    }

    if (style == 'satellite') {
        window.vortexData.map_type = 'satellite';

        set_dark();

        map.addSource('mapbox-satellite', { 'type': 'raster', 'url': 'mapbox://mapbox.satellite', 'tileSize': 256 });
        map.addLayer({ 'type': 'raster', 'id': 'satellite-map', 'source': 'mapbox-satellite' }, map_funcs.get_base_layer());
    } else if (style == 'dark') {
        window.vortexData.map_type = 'dark';

        set_dark();

        if (map.getLayer('satellite-map')) {
            map.removeLayer('satellite-map');
            map.removeSource('mapbox-satellite');
        }
    } else if (style == 'light') {
        window.vortexData.map_type = 'light';

        set_light();

        if (map.getLayer('satellite-map')) {
            map.removeLayer('satellite-map');
            map.removeSource('mapbox-satellite');
        }
    }

    set_layer_order();
}

module.exports = change_map_style;