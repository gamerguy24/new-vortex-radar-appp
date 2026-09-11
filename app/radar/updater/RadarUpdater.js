const product_abbv_dict = {
    'N0Q': 'p94r0',
    'N1Q': 'p94r1',
    'N2Q': 'p94r2',
    'N3Q': 'p94r3',

    'N0U': 'p99v0',
    'N1U': 'p99v1',
    'N2U': 'p99v2',
    'N3U': 'p99v3',

    // 'DVL': '134il'
}

class RadarUpdater {
    constructor(nexrad_factory) {
        const loaders_nexrad = require('../libnexrad/loaders_nexrad');

        this.nexrad_factory = nexrad_factory;
        this.latest_date = undefined;
        // Which pane this updater re-plots into (rides on the factory).
        this.target = (nexrad_factory && nexrad_factory.target) || 'main';

        var get_latest_url_func;
        var plot_func;
        if (this.nexrad_factory.nexrad_level == 2) {
            get_latest_url_func = loaders_nexrad.get_latest_level_2_url;
        } else if (this.nexrad_factory.nexrad_level == 3) {
            get_latest_url_func = loaders_nexrad.get_latest_level_3_url;

            if (this.nexrad_factory.storm_relative_velocity) {
                plot_func = (url) => {
                    const product = this._product_from_abbv(this.nexrad_factory.product_abbv);
                    loaders_nexrad.create_super_res_storm_relative_velocity(this.nexrad_factory.station, product,
                        (combinedFactory) => {
                            combinedFactory.target = this.target;
                            combinedFactory.plot();
                        });
                };
            } else {
                plot_func = (url) => loaders_nexrad.level_3_plot_from_url(url, null, this.target);
            }
        }
        this.get_latest_url_func = get_latest_url_func;
        this.plot_func = plot_func;
    }

    enable() {
        // Safe to call on a running updater: a second enable() used to start a
        // second interval alongside the first.
        this.disable();
        this.enabled = true;
        // Interval BEFORE the immediate check. That check can draw a new scan,
        // and drawing disables this updater — which only stops it if there is
        // already an interval to clear. The other order left one polling
        // forever whenever the answer came back before enable() finished.
        this.interval = setInterval(() => {
            this._check_for_new_file();
        }, 15000);   // check for a new radar scan every 15 seconds
        this._check_for_new_file();
    }

    disable() {
        this.enabled = false;
        clearInterval(this.interval);
    }

    /*
     * Replace a pane's updater with one for the file just drawn.
     *
     * The new updater inherits the old one's newest-known scan date when both
     * follow the same station and product. Without that, an updater's first
     * check simply adopts whatever is newest on the server as "already shown".
     * That is true when the file was just fetched AS the newest, and false when
     * it is an older scan — a loop's last frame, loaded ten minutes ago — which
     * then sat on screen until the next scan after that arrived. Inheriting,
     * the first check compares against what was really last seen, and catches
     * up at once.
     *
     * With start false the old updater is retired and no new one is started:
     * a loop's past frames are not the latest scan and must not poll as if
     * they were.
     */
    static hand_over(S, nexrad_factory, start) {
        const prev = S.current_RadarUpdater;
        if (prev != undefined) prev.disable();
        if (!start) return;
        const next = new RadarUpdater(nexrad_factory);
        const pf = prev && prev.nexrad_factory;
        if (prev && prev.latest_date && pf
            && pf.station === nexrad_factory.station && pf.product_abbv === nexrad_factory.product_abbv) {
            next.latest_date = prev.latest_date;
        }
        S.current_RadarUpdater = next;
        next.enable();
    }

    _check_for_new_file() {
        const { DateTime } = require('luxon');
        const formatted_now = DateTime.now().toFormat('h:mm.ss a ZZZZ');

        // this is so we can update the time elapsed counter in the top right
        this.nexrad_factory.display_file_info();
        const product = this._product_from_abbv(this.nexrad_factory.product_abbv);
        this.get_latest_url_func(this.nexrad_factory.station, product, 0, (url, fetched_date) => {
            this._process_update_check(url, fetched_date, formatted_now);
        })
    }
    _product_from_abbv(product) {
        if (product_abbv_dict.hasOwnProperty(product)) {
            return product_abbv_dict[product];
        }
        return product;
    }
    _process_update_check(url, fetched_date, formatted_now) {
        // An answer that lands after this updater was disabled — a check in
        // flight when a loop started playing, say — must not draw the newest
        // scan over whatever took over the map.
        if (!this.enabled) return;
        if (this.latest_date == undefined) {
            this.latest_date = fetched_date;
        }

        if (fetched_date.getTime() > this.latest_date.getTime()) {
            console.log(`Successfully found new radar scan at ${formatted_now}.`);
            this.latest_date = fetched_date;
            this.plot_func(url);
        } else {
            console.log(`There is no new radar scan as of ${formatted_now}.`);
        }
    }
}

module.exports = RadarUpdater;