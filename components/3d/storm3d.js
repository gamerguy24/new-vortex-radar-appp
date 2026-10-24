/*
 * 3d/storm3d.js
 * GR2Analyst-style 3D storm view. Opens a full-screen overlay, fetches the
 * latest Level-II volume for the active station, hands it to storm3d_worker for
 * gridding + marching-cubes isosurface extraction, and renders the result with
 * Three.js: nested reflectivity shells in the radar page's own colours, a
 * plan-view floor of the lowest tilt, a height/compass axis box, and orbit
 * controls.
 *
 * The box is centred where the map is looking (when that is within range of
 * the radar), sized from the map's zoom, and changeable from the Area menu.
 *
 * Look: shells are shaded with normals from the field's gradient (smooth, not
 * faceted), in the radar table's exact sRGB colours, and see-through face-on
 * but solid at their edges, so each layer reads as a volume and the core shows
 * through. Under the storm is a satellite or dark map of the box (Mapbox
 * tiles, the app's own token), with the lowest tilt painted over it.
 *
 * (c) David Wallis, Twistcaster Live Media LLC 2026
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { loadLatestL2RadarFile } from '../../parse/fetch.js';

const SCENE_SCALE = 1 / 1000;   // metres -> scene units (km)
const VERT_EXAG = 3.0;          // vertical exaggeration (storms read taller)
const KFT_TO_M = 304.8;
const AREAS_KM = [40, 80, 120, 180, 230];   // box half-width choices
const SHELL_STEP = { REF: 10 };             // layered shells every N units above the threshold
const BASEMAPS = {
  satellite: { label: 'Satellite', style: 'satellite-streets-v12', dim: 0.38 },
  dark: { label: 'Dark', style: 'dark-v11', dim: 0 },
  none: { label: 'Off' },
};
const BASEMAP_KEY = 'storm3dBasemap';
const BASEMAP_PX = 2048;                    // texture size across the box

const PRODUCT_UI = {
  REF: { label: 'Reflectivity',     min: 10,  max: 70,  step: 1,    def: 25,  unit: 'dBZ',  decimals: 0 },
  VEL: { label: 'Velocity',         min: 10,  max: 100, step: 1,    def: 40,  unit: 'kt',   decimals: 0 },
  CC:  { label: 'Correlation Coeff', min: 0.2, max: 1.0, step: 0.02, def: 0.9, unit: '',     decimals: 2 },
  ZDR: { label: 'Diff Reflectivity', min: -2,  max: 8,   step: 0.5,  def: 1,   unit: 'dB',   decimals: 1 },
  KDP: { label: 'Specific Diff Phase', min: -1, max: 4,  step: 0.25, def: 0.5, unit: 'deg/km', decimals: 2 },
  SW:  { label: 'Spectrum Width',   min: 1,   max: 25,  step: 1,    def: 8,   unit: 'kt',   decimals: 0 },
};
const DEFAULT_PRODUCT = 'REF';

export default class Storm3D {
  constructor(station) {
    this.station = station;
    this.worker = null;
    this.product = DEFAULT_PRODUCT;
    this.threshold = PRODUCT_UI[DEFAULT_PRODUCT].def;
    this.layered = true;
    this.lut = buildRefLut();
    this.view = initialView();
    this._raf = null;
    this._remarchTimer = null;
    this.shellMeshes = [];
    this.meta = null;
    this._activeTool = null;   // 'box' | 'xsect' | null (point-placement mode)
    this._toolPoints = [];
    this._boxHelper = null;
    this._xsectGroup = null;
    this._pointMarkers = [];
    this._preview = null;
    this._clickStart = null;
    this.basemap = 'satellite';
    try { if (BASEMAPS[localStorage.getItem(BASEMAP_KEY)]) this.basemap = localStorage.getItem(BASEMAP_KEY); } catch { /* keep the default */ }
    this._build();
  }

  _build() {
    const root = document.createElement('div');
    root.id = 'storm3d-overlay';
    const areaKm = Math.round(this.view.halfExtentM / 1000);
    root.innerHTML = `
      <div class="s3d-topbar">
        <div class="s3d-title"><i class="ti ti-box"></i> 3D Storm View
          <span class="s3d-station">${this.station || ''}</span>
          <span class="s3d-tilts" id="s3d-tilts"></span></div>
        <div class="s3d-controls">
          <label class="s3d-product">
            <span>Product</span>
            <select id="s3d-product">
              ${Object.entries(PRODUCT_UI).map(([k, v]) =>
                `<option value="${k}"${k === this.product ? ' selected' : ''}>${v.label}</option>`).join('')}
            </select>
          </label>
          <label class="s3d-product" id="s3d-style-wrap">
            <span>Shells</span>
            <select id="s3d-style">
              <option value="layered">Layered (dBZ colours)</option>
              <option value="single">Single (height colours)</option>
            </select>
          </label>
          <label class="s3d-product">
            <span>Area</span>
            <select id="s3d-area">
              ${AREAS_KM.map((km) => `<option value="${km}"${km === areaKm ? ' selected' : ''}>${km * 2} km</option>`).join('')}
            </select>
          </label>
          <label class="s3d-product">
            <span>Map</span>
            <select id="s3d-basemap">
              ${Object.entries(BASEMAPS).map(([k, v]) => `<option value="${k}"${k === this.basemap ? ' selected' : ''}>${v.label}</option>`).join('')}
            </select>
          </label>
          <label class="s3d-thresh">
            <span id="s3d-thresh-label">Lowest shell</span>
            <input type="range" id="s3d-threshold">
            <b id="s3d-thresh-val"></b>
          </label>
          <button id="s3d-reset" class="s3d-btn" title="Reset view"><i class="ti ti-restore"></i></button>
          <button id="s3d-close" class="s3d-btn s3d-close" title="Close"><i class="ti ti-x"></i></button>
        </div>
      </div>
      <div class="s3d-canvas-wrap"><canvas id="s3d-canvas"></canvas><div class="s3d-legend" id="s3d-legend"></div><div class="s3d-attrib" id="s3d-attrib"></div></div>
      <div class="s3d-loading" id="s3d-loading">
        <div class="s3d-spinner"></div>
        <div class="s3d-loading-text">Downloading the latest ${this.station || ''} volume...</div>
      </div>
      <div class="s3d-toolbar">
        <button class="s3d-tool" id="s3d-box-tool" title="Box Selector"><i class="ti ti-marquee-2"></i></button>
        <button class="s3d-tool" id="s3d-xsect-tool" title="Cross Section"><i class="ti ti-cut"></i></button>
      </div>
      <div class="s3d-hint">Drag to orbit &middot; scroll to zoom &middot; right-drag to pan</div>`;
    document.body.appendChild(root);
    this.root = root;

    this.canvas = root.querySelector('#s3d-canvas');
    this.loadingEl = root.querySelector('#s3d-loading');
    this.threshValEl = root.querySelector('#s3d-thresh-val');

    root.querySelector('#s3d-close').addEventListener('click', () => this.close());
    root.querySelector('#s3d-reset').addEventListener('click', () => this._resetView());
    this.slider = root.querySelector('#s3d-threshold');
    this.slider.addEventListener('input', (e) => this._onThreshold(Number(e.target.value)));
    this.productSelect = root.querySelector('#s3d-product');
    this.productSelect.addEventListener('change', (e) => this._onProduct(e.target.value));
    root.querySelector('#s3d-style').addEventListener('change', (e) => this._onStyle(e.target.value === 'layered'));
    root.querySelector('#s3d-area').addEventListener('change', (e) => this._onArea(Number(e.target.value)));
    root.querySelector('#s3d-basemap').addEventListener('change', (e) => this._onBasemap(e.target.value));
    this._applyProductUI(this.product);
    root.querySelector('#s3d-box-tool').addEventListener('click', () => this._toggleTool('box'));
    root.querySelector('#s3d-xsect-tool').addEventListener('click', () => this._toggleTool('xsect'));
    this.canvas.addEventListener('pointerdown', (e) => { this._clickStart = { x: e.clientX, y: e.clientY }; });
    this.canvas.addEventListener('click', (e) => this._onCanvasClick(e));
    this.canvas.addEventListener('pointermove', (e) => this._onCanvasMove(e));
    this._escHandler = (e) => {
      if (e.key === 'Escape') { if (this._activeTool) { this._cancelTool(); } else { this.close(); } }
    };
    document.addEventListener('keydown', this._escHandler);

    this._initThree();
    this._loadVolume();
  }

  _initThree() {
    const wrap = this.root.querySelector('.s3d-canvas-wrap');
    const w = wrap.clientWidth, h = wrap.clientHeight;

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);

    this.scene = new THREE.Scene();
    this.scene.background = skyTexture();
    this.scene.fog = new THREE.Fog(0x0b0f16, 700, 2200);

    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.5, 5000);
    this.camera.position.set(-180, 120, 220);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 20, 0);

    // Sky above, dim ground bounce below, a low sun from the south-west and a
    // cool fill from behind: tops catch the light, flanks fall into shade.
    this.scene.add(new THREE.HemisphereLight(0xe8f0ff, 0x1a1c22, 1.1));
    const key = new THREE.DirectionalLight(0xfff4e6, 2.2);
    key.position.set(-1.2, 1.6, 1.0);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xb8ccff, 0.6);
    fill.position.set(1, 0.4, -1.2);
    this.scene.add(fill);

    // Invisible ground plane for tool raycasting (click-to-place)
    this._pickPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(2000, 2000),
      new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
    );
    this._pickPlane.rotation.x = -Math.PI / 2;
    this.scene.add(this._pickPlane);
    this._raycaster = new THREE.Raycaster();
    this.renderer.localClippingEnabled = true;

    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);
    this._animate();
  }

  _animate() {
    this._raf = requestAnimationFrame(() => this._animate());
    this.controls?.update();
    this.renderer?.render(this.scene, this.camera);
  }

  _resize() {
    const wrap = this.root.querySelector('.s3d-canvas-wrap');
    if (!wrap) return;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  async _loadVolume() {
    try {
      const file = await loadLatestL2RadarFile(this.station);
      const data = file?.data;
      if (!data) throw new Error('No Level-II data returned for this station.');
      const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
      const ab = u8.slice().buffer;

      this._showSpinner('Building 3D volume...');
      this.worker = new Worker(new URL('./storm3d_worker.js?v=s3d3', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => this._onWorker(e.data);
      this.worker.onerror = (e) => this._fail(e.message || 'Worker error');
      this.worker.postMessage({
        type: 'build', arrayBuffer: ab, product: this.product, levels: this._levels(),
        view: this.view, lut: this.lut,
      }, [ab]);
    } catch (err) {
      // The server gates the volume download by tier; show the same upgrade
      // prompt as every other paid feature instead of an error box.
      if (err && err.status === 402) {
        this.close();
        window.vortexProGate?.denied('3D Storm View', err.requiredTier || 3);
        return;
      }
      this._fail(err?.message || String(err));
    }
  }

  _onWorker(msg) {
    if (msg.type === 'error') { this._fail(msg.message); return; }
    if (msg.type === 'built') {
      this.meta = msg.meta;
      this._clearXsect();
      this._buildAxes(msg.meta);
      this._buildGround(msg.ground);
      this._buildBasemap();
      this._buildRadarMarker(msg.meta);
      this._buildShells(msg.shells);
      const t = msg.meta.tilts;
      this.root.querySelector('#s3d-tilts').textContent = t.length ? `${t.length} tilts · ${t[0]}°–${t[t.length - 1]}°` : '';
      if (!this._hasFramed) { this._frameToData(msg.shells); this._hasFramed = true; }
      this.loadingEl.style.display = 'none';
    } else if (msg.type === 'shells') {
      this._buildShells(msg.shells);
      this.loadingEl.style.display = 'none';
    } else if (msg.type === 'crossSection') {
      this._renderXsect(msg);
      this.loadingEl.style.display = 'none';
    }
  }

  _fail(message) {
    if (!this.loadingEl) return;
    this.loadingEl.style.display = '';
    this.loadingEl.innerHTML =
      `<div class="s3d-error"><i class="ti ti-alert-triangle"></i><div>${message}</div>
       <button class="s3d-btn" id="s3d-err-close">Close</button></div>`;
    this.loadingEl.querySelector('#s3d-err-close')?.addEventListener('click', () => this.close());
  }

  _toScene(v) { return v * SCENE_SCALE; }
  _toSceneZ(v) { return v * SCENE_SCALE * VERT_EXAG; }

  // Contour levels for the current product/threshold/style.
  _levels() {
    const step = SHELL_STEP[this.product];
    if (!this.layered || !step) return [this.threshold];
    const ui = PRODUCT_UI[this.product];
    const out = [];
    for (let v = this.threshold; v <= ui.max + 5 && out.length < 6; v += step) out.push(v);
    return out;
  }
  _isLayered() { return this.layered && !!SHELL_STEP[this.product]; }

  _disposeShells() {
    const geos = new Set();
    for (const m of this.shellMeshes) { this.scene.remove(m); geos.add(m.geometry); m.material.dispose(); }
    geos.forEach((g) => g.dispose());
    this.shellMeshes = [];
  }

  /*
   * Layered: one shell per level in that level's colour from the radar page's
   * table. The outer shells are see-through face-on and solid edge-on (a rim),
   * so they read as soft envelopes with the stronger echo showing through;
   * the core is solid. Single: one shell coloured by height.
   *
   * Each see-through shell is drawn twice, its far side then its near side, so
   * it blends in the right order without sorting triangles. Draw order runs
   * from the core outward.
   */
  _buildShells(shells) {
    this._disposeShells();
    const layered = this._isLayered();
    const live = shells.filter((sh) => sh.positions && sh.positions.length);
    const n = live.length;
    const zTop = this.meta ? this.meta.zTopM : 20000;
    live.forEach((shell, k) => {
      const src = shell.positions, nrm = shell.normals;
      const pos = new Float32Array(src.length);
      const nor = new Float32Array(src.length);
      const col = layered ? null : new Float32Array(src.length);
      const tmp = new THREE.Color();
      for (let i = 0; i < src.length; i += 3) {
        pos[i]     = this._toScene(src[i]);
        pos[i + 1] = this._toSceneZ(src[i + 2]);
        pos[i + 2] = -this._toScene(src[i + 1]);
        // Normals scale by the inverse of the vertical stretch.
        const nx = nrm[i], ny = nrm[i + 2] / VERT_EXAG, nz = -nrm[i + 1];
        const len = Math.hypot(nx, ny, nz) || 1;
        nor[i] = nx / len; nor[i + 1] = ny / len; nor[i + 2] = nz / len;
        if (col) {
          const [r, g, b] = heightColor(src[i + 2] / zTop);
          tmp.setRGB(r, g, b, THREE.SRGBColorSpace);
          col[i] = tmp.r; col[i + 1] = tmp.g; col[i + 2] = tmp.b;
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      if (col) geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

      const rank = n > 1 ? k / (n - 1) : 0;           // 0 = outermost, 1 = core
      const core = layered && n > 1 && k === n - 1;
      const color = new THREE.Color();
      if (layered) { const rgb = lutRgb(this.lut, shell.level) || [0.8, 0.8, 0.8]; color.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace); }
      else color.set(0xffffff);
      // opacity: at the rim; face: share of it left face-on
      const opacity = core ? 1 : layered ? 0.5 + 0.4 * rank : 0.75;
      const face = core ? 1 : layered ? 0.16 + 0.5 * rank * rank : 0.4;
      const order = (n - k) * 2;                       // core first, outer shells last
      const passes = core ? [THREE.DoubleSide] : [THREE.BackSide, THREE.FrontSide];
      passes.forEach((side, j) => {
        const mat = shellMaterial({ color, vertexColors: !layered, opacity, face, side, solid: core });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.renderOrder = order + j;
        if (this._boxPlanes) mat.clippingPlanes = this._boxPlanes;
        this.scene.add(mesh);
        this.shellMeshes.push(mesh);
      });
    });
    this._renderLegend(live.map((sh) => sh.level));
  }

  _renderLegend(levels) {
    const el = this.root.querySelector('#s3d-legend');
    const ui = PRODUCT_UI[this.product];
    if (!this._isLayered()) {
      el.innerHTML = `<span class="s3d-legend-title">${ui.label}</span>
        <span class="s3d-legend-item">Shell at ${Number(this.threshold).toFixed(ui.decimals)} ${ui.unit}, coloured by height</span>`;
      return;
    }
    if (!levels.length) {
      el.innerHTML = `<span class="s3d-legend-item">No echo at or above ${this.threshold} ${ui.unit} in this area</span>`;
      return;
    }
    el.innerHTML = `<span class="s3d-legend-title">${ui.unit}</span>` + levels.map((v) => {
      const c = lutRgb(this.lut, v) || [0.8, 0.8, 0.8];
      const css = `rgb(${c.map((x) => Math.round(x * 255)).join(',')})`;
      return `<span class="s3d-legend-item"><i style="background:${css}"></i>${v}</span>`;
    }).join('');
  }

  _buildGround(ground) {
    if (this.groundMesh) {
      this.scene.remove(this.groundMesh);
      this.groundMesh.geometry.dispose(); this.groundMesh.material.map?.dispose(); this.groundMesh.material.dispose();
      this.groundMesh = null;
    }
    if (!ground || !ground.rgba || !this.meta) return;
    const tex = new THREE.DataTexture(new Uint8Array(ground.rgba), ground.size, ground.size, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    tex.needsUpdate = true;
    const side = 2 * this._toScene(this.meta.halfExtentM);
    const geo = new THREE.PlaneGeometry(side, side);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.88, side: THREE.DoubleSide, depthWrite: false });
    this.groundMesh = new THREE.Mesh(geo, mat);
    // PlaneGeometry is in XY with +Y up the texture; lay it flat so the
    // texture's top edge (north) points to scene -Z.
    this.groundMesh.rotation.x = -Math.PI / 2;
    this.groundMesh.position.y = 0.05;
    this.groundMesh.renderOrder = -1;
    if (this._boxPlanes) mat.clippingPlanes = this._boxPlanes;
    this.scene.add(this.groundMesh);
  }

  /*
   * The map under the box: Mapbox raster tiles (the app's token) stitched in
   * Web Mercator, then resampled row by row into the box's own flat
   * east/north frame so roads and towns sit under the right echoes.
   */
  async _buildBasemap() {
    const token = this._basemapToken = (this._basemapToken || 0) + 1;
    this._clearBasemap();
    const cfg = BASEMAPS[this.basemap];
    const accessToken = window.mapboxgl && window.mapboxgl.accessToken;
    const attrib = this.root.querySelector('#s3d-attrib');
    if (attrib) attrib.textContent = '';
    if (!cfg || !cfg.style || !accessToken || !this.meta || !this.meta.site) return;
    this._basemapPending = true;
    try {
      const { site, centre, halfExtentM } = this.meta;
      const cosLat = Math.cos(site.lat * Math.PI / 180);
      const lonAt = (east) => site.lon + east / (cosLat * 111320);
      const latAt = (north) => site.lat + north / 110574;
      const west = lonAt(centre.east - halfExtentM), east = lonAt(centre.east + halfExtentM);
      const south = latAt(centre.north - halfExtentM), north = latAt(centre.north + halfExtentM);

      // Zoom giving about BASEMAP_PX pixels across, in 512 px tiles.
      const z = Math.max(3, Math.min(12, Math.round(Math.log2((BASEMAP_PX * 360) / (512 * (east - west))))));
      const scale = 512 * 2 ** z;
      const mx = (lon) => ((lon + 180) / 360) * scale;
      const my = (lat) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * scale; };
      const tx0 = Math.floor(mx(west) / 512), tx1 = Math.floor(mx(east) / 512);
      const ty0 = Math.floor(my(north) / 512), ty1 = Math.floor(my(south) / 512);

      const mosaic = document.createElement('canvas');
      mosaic.width = (tx1 - tx0 + 1) * 512; mosaic.height = (ty1 - ty0 + 1) * 512;
      const mctx = mosaic.getContext('2d');
      const jobs = [];
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
        const url = `https://api.mapbox.com/styles/v1/mapbox/${cfg.style}/tiles/512/${z}/${tx}/${ty}?access_token=${encodeURIComponent(accessToken)}`;
        jobs.push(loadImage(url).then((img) => mctx.drawImage(img, (tx - tx0) * 512, (ty - ty0) * 512, 512, 512)).catch(() => {}));
      }
      await Promise.all(jobs);
      if (token !== this._basemapToken || !this.scene) return;

      // Columns are linear in longitude in both frames; rows are not, so copy one row at a time.
      const out = document.createElement('canvas');
      out.width = out.height = BASEMAP_PX;
      const octx = out.getContext('2d');
      const sx = mx(west) - tx0 * 512, sw = mx(east) - mx(west);
      for (let py = 0; py < BASEMAP_PX; py++) {
        const lat = latAt(centre.north + halfExtentM - ((py + 0.5) / BASEMAP_PX) * 2 * halfExtentM);
        octx.drawImage(mosaic, sx, my(lat) - ty0 * 512, sw, 1, 0, py, BASEMAP_PX, 1);
      }
      // Dim busy imagery so the echoes stay the brightest thing on screen.
      if (cfg.dim) { octx.fillStyle = `rgba(4,8,14,${cfg.dim})`; octx.fillRect(0, 0, BASEMAP_PX, BASEMAP_PX); }

      const tex = new THREE.CanvasTexture(out);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      const side = 2 * this._toScene(halfExtentM);
      const mat = new THREE.MeshBasicMaterial({ map: tex, fog: true });
      if (this._boxPlanes) mat.clippingPlanes = this._boxPlanes;
      this.basemapMesh = new THREE.Mesh(new THREE.PlaneGeometry(side, side), mat);
      this.basemapMesh.rotation.x = -Math.PI / 2;
      this.basemapMesh.renderOrder = -2;
      this.scene.add(this.basemapMesh);
      if (attrib) attrib.textContent = cfg.style.startsWith('satellite') ? '\u00a9 Mapbox \u00a9 OpenStreetMap \u00a9 Maxar' : '\u00a9 Mapbox \u00a9 OpenStreetMap';
    } finally {
      if (token === this._basemapToken) this._basemapPending = false;
    }
  }

  _clearBasemap() {
    if (!this.basemapMesh) return;
    this.scene.remove(this.basemapMesh);
    this.basemapMesh.geometry.dispose(); this.basemapMesh.material.map?.dispose(); this.basemapMesh.material.dispose();
    this.basemapMesh = null;
  }

  _onBasemap(key) {
    if (!BASEMAPS[key]) return;
    this.basemap = key;
    try { localStorage.setItem(BASEMAP_KEY, key); } catch { /* not remembered, still applied */ }
    this._buildBasemap();
  }

  _buildRadarMarker(meta) {
    if (this.radarMarker) { this.scene.remove(this.radarMarker); this.radarMarker = null; }
    const half = meta.halfExtentM;
    const { east, north } = meta.radar;
    if (Math.abs(east) > half || Math.abs(north) > half) return;   // radar outside the box
    const group = new THREE.Group();
    const x = this._toScene(east), z = -this._toScene(north);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([x, 0, z, x, 8, z]), 3));
    group.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffffff })));
    group.add(this._label(this.station || 'RADAR', x, 11, z, 0.8));
    this.radarMarker = group;
    this.scene.add(group);
  }

  _buildAxes(meta) {
    if (this.axesGroup) { this.scene.remove(this.axesGroup); }
    const group = new THREE.Group();
    const half = this._toScene(meta.halfExtentM);
    const top = this._toSceneZ(meta.zTopM);

    const gmat = new THREE.LineBasicMaterial({ color: 0x2a3340 });
    const ring = [];
    const step = half / 4;
    for (let gx = -half; gx <= half + 0.1; gx += step) {
      ring.push(gx, 0, -half, gx, 0, half, -half, 0, gx, half, 0, gx);
    }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ring), 3));
    group.add(new THREE.LineSegments(gg, gmat));

    // The box itself: twelve edges, as in GR2Analyst.
    const frame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(2 * half, top, 2 * half)),
      new THREE.LineBasicMaterial({ color: 0xc8d2e0, transparent: true, opacity: 0.55 }),
    );
    frame.position.y = top / 2;
    group.add(frame);

    // Height scale on the north-west corner, guide lines round the north and
    // east walls: the far side from the default south-west view, so the
    // labels sit behind the storm instead of across it.
    const cx = -half, cz = -half;
    const amat = new THREE.LineBasicMaterial({ color: 0x8a96aa });
    const vline = new THREE.BufferGeometry();
    vline.setAttribute('position', new THREE.BufferAttribute(new Float32Array([cx, 0, cz, cx, top, cz]), 3));
    group.add(new THREE.LineSegments(vline, amat));

    const labelScale = Math.max(0.6, half / 140);
    for (let kft = 10; kft <= 70; kft += 10) {
      const y = this._toSceneZ(kft * KFT_TO_M);
      if (y > top) break;
      const tick = new THREE.BufferGeometry();
      tick.setAttribute('position', new THREE.BufferAttribute(new Float32Array([cx, y, cz, cx - 6 * labelScale, y, cz]), 3));
      group.add(new THREE.LineSegments(tick, amat));
      const guide = new THREE.BufferGeometry();
      guide.setAttribute('position', new THREE.BufferAttribute(new Float32Array([cx, y, cz, half, y, cz, half, y, -cz]), 3));
      group.add(new THREE.Line(guide, new THREE.LineBasicMaterial({ color: 0x8a96aa, transparent: true, opacity: 0.35 })));
      group.add(this._label(`${kft} kft`, cx - 22 * labelScale, y, cz, 1.25 * labelScale));
    }

    const off = 10 * labelScale;
    group.add(this._label('WEST',  -half - off, 0, 0, 1.2 * labelScale));
    group.add(this._label('EAST',   half + off, 0, 0, 1.2 * labelScale));
    group.add(this._label('SOUTH',  0, 0, half + off, 1.2 * labelScale));
    group.add(this._label('NORTH',  0, 0, -half - off, 1.2 * labelScale));

    this.axesGroup = group;
    this.scene.add(group);
  }

  _label(text, x, y, z, scale = 1) {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    const fs = 48;
    ctx.font = `600 ${fs}px Onest, sans-serif`;
    c.width = ctx.measureText(text).width + 20;
    c.height = fs + 16;
    ctx.font = `600 ${fs}px Onest, sans-serif`;
    ctx.fillStyle = 'rgba(225,235,245,0.9)';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 10, c.height / 2);
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    const aspect = c.width / c.height;
    spr.scale.set(14 * scale * aspect / 3, 14 * scale / 3, 1);
    spr.position.set(x, y, z);
    return spr;
  }

  // Aim at the strongest echo (innermost non-empty shell), framed to the outer one.
  _frameToData(shells) {
    const outer = shells.find((s) => s.positions && s.positions.length);
    if (!outer) {
      const d = this._toScene(this.meta ? this.meta.halfExtentM : 120000) * 2.2;
      this._home = { target: new THREE.Vector3(0, 10, 0), pos: new THREE.Vector3(-d * 0.7, d * 0.5, d * 0.8) };
      this._resetView();
      return;
    }
    const core = [...shells].reverse().find((s) => s.positions && s.positions.length) || outer;
    const p = core.positions;
    let cx = 0, cz = 0, count = 0;
    for (let i = 0; i < p.length; i += 3) { cx += this._toScene(p[i]); cz += -this._toScene(p[i + 1]); count++; }
    cx /= count; cz /= count;
    // Size the shot from the second shell's typical spread around the core —
    // the outermost shell's farthest point is usually a stray speck across
    // the box, which would leave the storm tiny in the middle of the frame.
    const frame = shells.filter((s) => s.positions && s.positions.length)[1] || outer;
    const q = frame.positions;
    const radii = [];
    for (let i = 0; i < q.length; i += 9) radii.push(Math.hypot(this._toScene(q[i]) - cx, -this._toScene(q[i + 1]) - cz));
    radii.sort((a, b) => a - b);
    const spread = radii[Math.floor(radii.length * 0.6)] || 30;
    const dist = Math.max(140, Math.min(spread * 4.2, this._toScene(this.meta.halfExtentM) * 2.6));
    // Aim at the outer shell's mid-height so a tall tower fits the frame.
    let top = 0;
    for (let i = 2; i < outer.positions.length; i += 9) top = Math.max(top, outer.positions[i]);
    const aimY = Math.min(45, Math.max(10, this._toSceneZ(top) * 0.45));
    this._home = {
      target: new THREE.Vector3(cx, aimY, cz),
      pos: new THREE.Vector3(cx - dist * 0.7, dist * 0.42, cz + dist * 0.8),
    };
    this._resetView();
  }

  _resetView() {
    if (!this._home) return;
    this.controls.target.copy(this._home.target);
    this.camera.position.copy(this._home.pos);
    this.controls.update();
  }

  _applyProductUI(product) {
    const ui = PRODUCT_UI[product] || PRODUCT_UI[DEFAULT_PRODUCT];
    this.slider.min = ui.min;
    this.slider.max = ui.max;
    this.slider.step = ui.step;
    this.slider.value = this.threshold;
    this.root.querySelector('#s3d-style-wrap').style.display = SHELL_STEP[product] ? '' : 'none';
    this.root.querySelector('#s3d-thresh-label').textContent = this._isLayered() ? 'Lowest shell' : 'Isosurface';
    this._renderThreshReadout(ui);
  }

  _renderThreshReadout(ui) {
    const u = ui || PRODUCT_UI[this.product] || PRODUCT_UI[DEFAULT_PRODUCT];
    const v = Number(this.threshold).toFixed(u.decimals);
    this.threshValEl.textContent = u.unit ? `${v} ${u.unit}` : v;
  }

  _showSpinner(text) {
    this.loadingEl.style.display = '';
    this.loadingEl.innerHTML =
      `<div class="s3d-spinner"></div><div class="s3d-loading-text">${text}</div>`;
  }

  _onProduct(product) {
    if (product === this.product) return;
    this.product = product;
    this.threshold = PRODUCT_UI[product].def;
    this._applyProductUI(product);
    if (!this.worker) return;
    this._showSpinner(`Building ${PRODUCT_UI[product].label}...`);
    this.worker.postMessage({ type: 'product', product, levels: this._levels() });
  }

  _onStyle(layered) {
    this.layered = layered;
    this._applyProductUI(this.product);
    this._remarch();
  }

  _onArea(km) {
    this.view = { ...this.view, halfExtentM: km * 1000 };
    if (!this.worker) return;
    this._showSpinner('Rebuilding volume...');
    this._hasFramed = false;
    this._clearBox();
    this.worker.postMessage({ type: 'view', view: this.view, levels: this._levels() });
  }

  _onThreshold(val) {
    this.threshold = val;
    this._renderThreshReadout();
    clearTimeout(this._remarchTimer);
    this._remarchTimer = setTimeout(() => this._remarch(), 220);
  }

  _remarch() {
    if (!this.worker) return;
    this._showSpinner('Rebuilding isosurface...');
    this.worker.postMessage({ type: 'remarch', levels: this._levels() });
  }

  // ── Tool system: box selector + cross-section ───────────────────────────────

  _toggleTool(tool) {
    // Clicking the active tool's button cancels placement mode
    if (this._activeTool === tool) { this._cancelTool(); return; }
    if (this._activeTool) this._cancelTool();
    // If this tool already has a result, toggle it off
    if (tool === 'box' && this._boxHelper) { this._clearBox(); return; }
    if (tool === 'xsect' && this._xsectGroup) { this._clearXsect(); return; }
    // Clear any other tool's results, then enter placement mode
    this._clearBox(); this._clearXsect();
    this._activeTool = tool;
    this._toolPoints = [];
    this._updateToolUI();
    const hint = this.root.querySelector('.s3d-hint');
    hint.textContent = tool === 'box'
      ? 'Click two corners on the ground to define the box'
      : 'Click two points on the ground to define the cross section';
  }

  _cancelTool() {
    this._activeTool = null;
    this._toolPoints = [];
    this._removePreview();
    this._removePointMarkers();
    this._updateToolUI();
    this.root.querySelector('.s3d-hint').textContent = 'Drag to orbit \u00b7 scroll to zoom \u00b7 right-drag to pan';
  }

  _updateToolUI() {
    this.root.querySelector('#s3d-box-tool')?.classList.toggle('active', this._activeTool === 'box' || !!this._boxHelper);
    this.root.querySelector('#s3d-xsect-tool')?.classList.toggle('active', this._activeTool === 'xsect' || !!this._xsectGroup);
  }

  _groundHit(e) {
    const rect = this.canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    this._raycaster.setFromCamera(mouse, this.camera);
    const hits = this._raycaster.intersectObject(this._pickPlane);
    return hits.length ? hits[0].point : null;
  }

  _onCanvasClick(e) {
    if (!this._activeTool) return;
    // Ignore drags (orbit gestures)
    if (this._clickStart) {
      const dx = e.clientX - this._clickStart.x, dy = e.clientY - this._clickStart.y;
      if (dx * dx + dy * dy > 36) return;
    }
    const pt = this._groundHit(e);
    if (!pt) return;
    this._toolPoints.push(pt.clone());
    this._addPointMarker(pt, this._toolPoints.length);
    if (this._toolPoints.length === 2) {
      this._removePreview();
      if (this._activeTool === 'box') this._applyBox();
      else if (this._activeTool === 'xsect') this._applyXsect();
    }
  }

  _onCanvasMove(e) {
    if (!this._activeTool || this._toolPoints.length !== 1) return;
    const pt = this._groundHit(e);
    if (!pt) return;
    this._updatePreview(pt);
  }

  // --- point markers (numbered sprites at click locations) ---

  _addPointMarker(pt, num) {
    const spr = this._label(String(num), pt.x, 3, pt.z, 0.8);
    this.scene.add(spr);
    this._pointMarkers.push(spr);
  }
  _removePointMarkers() {
    this._pointMarkers.forEach((m) => { this.scene.remove(m); m.material?.map?.dispose(); m.material?.dispose(); });
    this._pointMarkers = [];
  }

  // --- live preview line/rectangle while placing the second point ---

  _updatePreview(pt) {
    this._removePreview();
    const p1 = this._toolPoints[0];
    const mat = new THREE.LineBasicMaterial({ color: this._activeTool === 'box' ? 0xffffff : 0x27beff, transparent: true, opacity: 0.6 });
    let geo;
    if (this._activeTool === 'box') {
      geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(p1.x, 0.5, p1.z), new THREE.Vector3(pt.x, 0.5, p1.z),
        new THREE.Vector3(pt.x, 0.5, pt.z), new THREE.Vector3(p1.x, 0.5, pt.z),
        new THREE.Vector3(p1.x, 0.5, p1.z),
      ]);
    } else {
      geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(p1.x, 0.5, p1.z), new THREE.Vector3(pt.x, 0.5, pt.z),
      ]);
    }
    this._preview = new THREE.Line(geo, mat);
    this.scene.add(this._preview);
  }
  _removePreview() {
    if (this._preview) {
      this.scene.remove(this._preview);
      this._preview.geometry?.dispose(); this._preview.material?.dispose();
      this._preview = null;
    }
  }

  // ── Box Selector ───────────────────────────────────────────────────────────

  _applyBox() {
    const [p1, p2] = this._toolPoints;
    const minX = Math.min(p1.x, p2.x), maxX = Math.max(p1.x, p2.x);
    const minZ = Math.min(p1.z, p2.z), maxZ = Math.max(p1.z, p2.z);
    const top = this.meta ? this._toSceneZ(this.meta.zTopM) : 200;

    // Wireframe box
    const geo = new THREE.BoxGeometry(maxX - minX, top, maxZ - minZ);
    const edges = new THREE.EdgesGeometry(geo);
    const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 });
    const box = new THREE.LineSegments(edges, mat);
    box.position.set((minX + maxX) / 2, top / 2, (minZ + maxZ) / 2);
    this.scene.add(box);
    this._boxHelper = box;

    // Clip everything outside the box (plane normals point inward)
    const planes = [
      new THREE.Plane(new THREE.Vector3( 1, 0, 0), -minX),
      new THREE.Plane(new THREE.Vector3(-1, 0, 0),  maxX),
      new THREE.Plane(new THREE.Vector3( 0, 0, 1), -minZ),
      new THREE.Plane(new THREE.Vector3( 0, 0,-1),  maxZ),
    ];
    this._boxPlanes = planes;
    for (const m of this.shellMeshes) m.material.clippingPlanes = planes;
    if (this.groundMesh) this.groundMesh.material.clippingPlanes = planes;
    if (this.basemapMesh) this.basemapMesh.material.clippingPlanes = planes;

    this._activeTool = null;
    this._updateToolUI();
    this.root.querySelector('.s3d-hint').textContent = 'Box applied \u00b7 click box tool to clear';
  }

  _clearBox() {
    if (this._boxHelper) {
      this.scene.remove(this._boxHelper);
      this._boxHelper.geometry?.dispose(); this._boxHelper.material?.dispose();
      this._boxHelper = null;
    }
    this._boxPlanes = null;
    for (const m of this.shellMeshes) m.material.clippingPlanes = [];
    if (this.groundMesh) this.groundMesh.material.clippingPlanes = [];
    if (this.basemapMesh) this.basemapMesh.material.clippingPlanes = [];
    this._removePointMarkers();
    this._updateToolUI();
    this.root.querySelector('.s3d-hint').textContent = 'Drag to orbit \u00b7 scroll to zoom \u00b7 right-drag to pan';
  }

  // ── Cross Section ──────────────────────────────────────────────────────────

  _applyXsect() {
    const [p1, p2] = this._toolPoints;
    // Convert scene coords back to world metres for the worker
    const w1 = { east: p1.x / SCENE_SCALE, north: -p1.z / SCENE_SCALE };
    const w2 = { east: p2.x / SCENE_SCALE, north: -p2.z / SCENE_SCALE };
    this._showSpinner('Building cross section...');
    this.worker.postMessage({ type: 'crossSection', p1: w1, p2: w2 });
    this._activeTool = null;
    this._updateToolUI();
  }

  _renderXsect(msg) {
    this._clearXsect();
    const { rgba, width, height, p1, p2 } = msg;

    const group = new THREE.Group();

    // Textured vertical plane built from explicit corners (no rotation math)
    const sp1 = new THREE.Vector3(this._toScene(p1.east), 0, -this._toScene(p1.north));
    const sp2 = new THREE.Vector3(this._toScene(p2.east), 0, -this._toScene(p2.north));
    const top = this._toSceneZ(this.meta?.zTopM || 22000);

    const tex = new THREE.DataTexture(new Uint8Array(rgba), width, height, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;

    const positions = new Float32Array([
      sp1.x, 0,   sp1.z,    sp2.x, 0,   sp2.z,    sp2.x, top, sp2.z,
      sp1.x, 0,   sp1.z,    sp2.x, top, sp2.z,    sp1.x, top, sp1.z,
    ]);
    const uvs = new Float32Array([ 0,0, 1,0, 1,1, 0,0, 1,1, 0,1 ]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false });
    group.add(new THREE.Mesh(geo, mat));

    // Height labels along the right endpoint
    const dir = sp2.clone().sub(sp1).normalize();
    const offset = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(6); // perpendicular
    for (let kft = 0; kft <= 70; kft += 4) {
      const y = this._toSceneZ(kft * KFT_TO_M);
      if (y > top + 1) break;
      group.add(this._label(`${kft}kft`, sp2.x + offset.x, y, sp2.z + offset.z, 0.45));
    }

    // Endpoint labels
    group.add(this._label('1', sp1.x, -4, sp1.z, 0.8));
    group.add(this._label('2', sp2.x, -4, sp2.z, 0.8));

    this._xsectGroup = group;
    this.scene.add(group);
    this._removePointMarkers();
    this.root.querySelector('.s3d-hint').textContent = 'Cross section applied \u00b7 click tool to clear';
  }

  _clearXsect() {
    if (this._xsectGroup) {
      this._xsectGroup.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
      });
      this.scene.remove(this._xsectGroup);
      this._xsectGroup = null;
    }
    this._removePointMarkers();
    this._updateToolUI();
    this.root.querySelector('.s3d-hint').textContent = 'Drag to orbit \u00b7 scroll to zoom \u00b7 right-drag to pan';
  }

  close() {
    this._cancelTool(); this._clearBox(); this._clearXsect(); this._clearBasemap();
    this._basemapToken = (this._basemapToken || 0) + 1;
    if (this._raf) cancelAnimationFrame(this._raf);
    clearTimeout(this._remarchTimer);
    document.removeEventListener('keydown', this._escHandler);
    window.removeEventListener('resize', this._onResize);
    this.worker?.terminate();
    this.controls?.dispose();
    this.renderer?.dispose();
    this.scene?.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { Array.isArray(o.material) ? o.material.forEach((m) => m.dispose()) : o.material.dispose(); }
    });
    this.root?.remove();
  }
}

/*
 * The radar page's reflectivity table (window.vortexColormaps.REF, which the
 * colortable menu and uploads replace) as plain stops for the worker. The
 * table is colours at values; SolidColor rows arrive as duplicated stops, so
 * interpolating between stops reproduces it exactly — and looking stops up
 * directly (never via a resampled table) keeps 25.0 dBZ on the same side of
 * a colour boundary as the radar page puts it.
 */
function buildRefLut() {
  const cm = window.vortexColormaps && window.vortexColormaps.REF;
  if (!cm || !cm.colors || !cm.values || cm.colors.length < 2) return null;
  const stops = cm.values.map((v, i) => [v, parseRgb(cm.colors[i])]).filter((s) => s[1] && Number.isFinite(s[0]) && s[0] < 900);
  if (stops.length < 2) return null;
  const values = new Float32Array(stops.map((s) => s[0]));
  const rgb = new Float32Array(stops.flatMap((s) => s[1].map((c) => c / 255)));
  return { values, rgb };
}
function parseRgb(css) {
  const s = String(css || '').trim();
  const m = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
  if (m) return [+m[1], +m[2], +m[3]];
  const h = /^#([0-9a-f]{6})$/i.exec(s);
  return h ? [0, 2, 4].map((o) => parseInt(h[1].slice(o, o + 2), 16)) : null;
}
// Colour of v in the table: last stop at or below v, blended toward the next.
// Same function as lutColour() in storm3d_worker.js — keep the two in step.
function lutRgb(lut, v) {
  if (!lut) return null;
  const vals = lut.values, n = vals.length, c = lut.rgb;
  if (!(v >= vals[0])) return null;
  let lo = 0, hi = n - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (vals[mid] <= v) lo = mid; else hi = mid - 1; }
  if (lo === n - 1) return [c[lo * 3], c[lo * 3 + 1], c[lo * 3 + 2]];
  const t = vals[lo + 1] > vals[lo] ? (v - vals[lo]) / (vals[lo + 1] - vals[lo]) : 0;
  return [0, 1, 2].map((j) => c[lo * 3 + j] + t * (c[(lo + 1) * 3 + j] - c[lo * 3 + j]));
}

// Box centred on the map view, half-width from its zoom (snapped to the Area menu).
function initialView() {
  const view = { centre: null, halfExtentM: 120000 };
  try {
    const map = window.vortexMap && window.vortexMap.map;
    if (!map) return view;
    const c = map.getCenter();
    view.centre = { lat: c.lat, lon: c.lng };
    const b = map.getBounds();
    const halfKm = (b.getEast() - b.getWest()) * Math.cos(c.lat * Math.PI / 180) * 111.32 / 2;
    view.halfExtentM = AREAS_KM.reduce((best, km) => (Math.abs(km - halfKm) < Math.abs(best - halfKm) ? km : best)) * 1000;
  } catch { /* fall back to the radar-centred default */ }
  return view;
}

function heightColor(t) {
  const stops = [
    [0.00, 0.85, 0.20, 0.75],
    [0.25, 0.90, 0.15, 0.15],
    [0.45, 1.00, 0.55, 0.10],
    [0.70, 0.80, 0.80, 0.15],
    [1.00, 0.30, 0.75, 0.20],
  ];
  const x = Math.max(0, Math.min(1, t));
  for (let i = 0; i < stops.length - 1; i++) {
    if (x >= stops[i][0] && x <= stops[i + 1][0]) {
      const f = (x - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
      return [
        stops[i][1] + f * (stops[i + 1][1] - stops[i][1]),
        stops[i][2] + f * (stops[i + 1][2] - stops[i][2]),
        stops[i][3] + f * (stops[i + 1][3] - stops[i][3]),
      ];
    }
  }
  return [0.3, 0.75, 0.2];
}

/*
 * Shell material: standard lighting, plus a rim term on the alpha. Face-on the
 * shell keeps `face` of its opacity, edge-on all of it, which is what makes a
 * translucent isosurface read as a solid volume rather than a film.
 */
function shellMaterial({ color, vertexColors, opacity, face, side, solid }) {
  const mat = new THREE.MeshStandardMaterial({
    color, vertexColors, side,
    transparent: !solid, opacity, depthWrite: solid,
    roughness: 0.62, metalness: 0,
    emissive: color, emissiveIntensity: vertexColors ? 0 : 0.12,
  });
  if (!solid) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uS3dFace = { value: face };
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'uniform float uS3dFace;\nvoid main() {')
        .replace('#include <opaque_fragment>', `
          float s3dRim = 1.0 - abs(dot(normalize(normal), normalize(vViewPosition)));
          diffuseColor.a = opacity * mix(uS3dFace, 1.0, pow(s3dRim, 1.6));
          #include <opaque_fragment>`);
    };
    mat.customProgramCacheKey = () => 's3d-rim';
  }
  return mat;
}

// Night-sky gradient behind the scene.
function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 2; c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#1b2638');
  g.addColorStop(0.55, '#0d121b');
  g.addColorStop(1, '#06080c');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('tile failed'));
    img.src = url;
  });
}
