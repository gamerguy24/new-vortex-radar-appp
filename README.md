# Vortex Radar

A clean, simple, but powerful weather toolkit for the web browser. Includes NEXRAD parsing and plotting, doppler velocity dealiasing, weather alerts, real time lightning data, METAR station data, animated radar loops, and much more.

**Vortex Radar** is developed and maintained by **David Wallis** under **Twistcaster Live Media LLC**.

## Features
- NEXRAD Level 2 and Level 3 radar parsing and plotting (client-side)
- Animated radar loop playback with adjustable speed
- Doppler velocity dealiasing
- NWS weather alerts, watches, and statements
- Real-time lightning data
- METAR surface station data
- SPC convective outlooks, surface fronts, tide stations, and weather radio

## Setup
```
git clone <your-repo-url>
cd AtticRadar
npm install
npm run build
npm run start
```
The dev server runs on port `3333`, so open `localhost:3333` to view your local copy of Vortex Radar.

Browserify is used to implement a module system. `npm run build` bundles and minifies the project for distribution. You can also run `npm run serve` to auto-rebundle on every change while developing.

## Credits
Vortex Radar builds on open-source radar parsing work. The libraries that parse NEXRAD files client-side were ported to JavaScript from two Python packages:
- Level 2 parsing comes from [nexrad_level2.py](https://github.com/ARM-DOE/pyart/blob/main/pyart/io/nexrad_level2.py), ported from [pyart](https://github.com/ARM-DOE/pyart/)
- Level 3 parsing comes from [nexrad.py](https://github.com/Unidata/MetPy/blob/main/src/metpy/io/nexrad.py), ported from [MetPy](https://github.com/Unidata/MetPy/)

The doppler dealiasing implementation is based on pyart's [region-based](https://github.com/ARM-DOE/pyart/blob/main/pyart/correct/region_dealias.py) dealiasing algorithm.

## ⚠️ Disclaimer ⚠️
Vortex Radar is a hobby/proof-of-concept project that does not follow rigorous safety testing, so the accuracy or 24/7 availability of the data is not always guaranteed.

🚨 **Vortex Radar should NEVER be used for life-saving information! ALWAYS go to the NWS or other sources with accurate data and information!!!** 🚨

Some apps with data that is known to be accurate include [radar.weather.gov](https://radar.weather.gov), RadarScope, RadarOmega, and [supercell-wx](https://github.com/dpaulat/supercell-wx).

---
© Twistcaster Live Media LLC. Created by David Wallis.
