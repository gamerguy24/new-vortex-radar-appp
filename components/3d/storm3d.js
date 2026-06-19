/*
 * 3d/storm3d.js
 * GR2Analyst-style 3D storm view. Opens a full-screen overlay, fetches the
 * latest Level-II volume for the active station, hands it to storm3d_worker for
 * voxelization + marching-cubes isosurface extraction, and renders the result
 * with Three.js: a translucent height-coloured reflectivity isosurface, a
 * ground plan view, a height/compass axis box, and orbit controls.
 *
 * (c) David Wallis, Twistcaster Live Media LLC 2026
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { loadLatestL2RadarFile } from '../../parse/fetch.js';

const SCENE_SCALE = 1 / 1000;   // metres -> scene units (km)
const VERT_EXAG = 3.0;          // vertical exaggeration (storms read taller)
const KFT_TO_M = 304.8;

const PRODUCT_UI = {
  REF: { label: 'Reflectivity',     min: 10,  max: 70,  step: 1,    def: 35,  unit: 'dBZ',  decimals: 0 },
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
    this._raf = null;
    this._remarchTimer = null;
    this.isoMesh = null;
    this.meta = null;
    this._build();
  }

  _build() {
    const root = document.createElement('div');
    root.id = 'storm3d-overlay';
    root.innerHTML = `
      <div class="s3d-topbar">
        <div class="s3d-title"><i class="ti ti-box"></i> 3D Storm View
          <span class="s3d-station">${this.station || ''}</span></div>
        <div class="s3d-controls">
          <label class="s3d-product">
            <span>Product</span>
            <select id="s3d-product">
              ${Object.entries(PRODUCT_UI).map(([k, v]) =>
                `<option value="${k}"${k === this.product ? ' selected' : ''}>${v.label}</option>`).join('')}
            </select>
          </label>
          <label class="s3d-thresh">
            <span>Isosurface</span>
            <input type="range" id="s3d-threshold">
            <b id="s3d-thresh-val"></b>
          </label>
          <button id="s3d-reset" class="s3d-btn" title="Reset view"><i class="ti ti-restore"></i></button>
          <button id="s3d-close" class="s3d-btn s3d-close" title="Close"><i class="ti ti-x"></i></button>
        </div>
      </div>
      <div class="s3d-canvas-wrap"><canvas id="s3d-canvas"></canvas></div>
      <div class="s3d-loading" id="s3d-loading">
        <div class="s3d-spinner"></div>
        <div class="s3d-loading-text">Building 3D volume...</div>
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
    this._applyProductUI(this.product);
    this._escHandler = (e) => { if (e.key === 'Escape') this.close(); };
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
    this.scene.background = new THREE.Color(0x0a0d12);
    this.scene.fog = new THREE.Fog(0x0a0d12, 400, 1400);

    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.5, 5000);
    this.camera.position.set(-180, 120, 220);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 20, 0);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const key = new THREE.DirectionalLight(0xffffff, 0.6);
    key.position.set(-1, 2, 1);
    this.scene.add(key);

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

      this.worker = new Worker(new URL('./storm3d_worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => this._onWorker(e.data);
      this.worker.onerror = (e) => this._fail(e.message || 'Worker error');
      this.worker.postMessage({ type: 'build', arrayBuffer: ab, product: this.product, threshold: this.threshold }, [ab]);
    } catch (err) {
      this._fail(err?.message || String(err));
    }
  }

  _onWorker(msg) {
    if (msg.type === 'error') { this._fail(msg.message); return; }
    if (msg.type === 'built') {
      this.meta = msg.meta;
      this._buildAxes(msg.meta);
      this._buildGround(msg.ground);
      this._buildIsosurface(msg.isoPositions);
      if (!this._hasFramed) { this._frameToData(msg.isoPositions); this._hasFramed = true; }
      this.loadingEl.style.display = 'none';
    } else if (msg.type === 'isosurface') {
      this._buildIsosurface(msg.positions);
      this.loadingEl.style.display = 'none';
    }
  }

  _fail(message) {
    if (!this.loadingEl) return;
    this.loadingEl.innerHTML =
      `<div class="s3d-error"><i class="ti ti-alert-triangle"></i><div>${message}</div>
       <button class="s3d-btn" id="s3d-err-close">Close</button></div>`;
    this.loadingEl.querySelector('#s3d-err-close')?.addEventListener('click', () => this.close());
  }

  _toScene(v) { return v * SCENE_SCALE; }
  _toSceneZ(v) { return v * SCENE_SCALE * VERT_EXAG; }

  _buildIsosurface(worldPositions) {
    if (this.isoMesh) { this.scene.remove(this.isoMesh); this.isoMesh.geometry.dispose(); this.isoMesh.material.dispose(); this.isoMesh = null; }
    if (!worldPositions || worldPositions.length === 0) return;

    const n = worldPositions.length;
    const pos = new Float32Array(n);
    const col = new Float32Array(n);
    const zTop = this.meta ? this.meta.zTopM : 22000;
    for (let i = 0; i < n; i += 3) {
      const east = worldPositions[i];
      const north = worldPositions[i + 1];
      const height = worldPositions[i + 2];
      pos[i]     = this._toScene(east);
      pos[i + 1] = this._toSceneZ(height);
      pos[i + 2] = -this._toScene(north);
      const [r, g, b] = heightColor(height / zTop);
      col[i] = r; col[i + 1] = g; col[i + 2] = b;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, transparent: true, opacity: 0.42,
      side: THREE.DoubleSide, depthWrite: false,
      roughness: 0.9, metalness: 0.0,
    });
    this.isoMesh = new THREE.Mesh(geo, mat);
    this.scene.add(this.isoMesh);
  }

  _buildGround(ground) {
    if (this.groundMesh) { this.scene.remove(this.groundMesh); this.groundMesh.geometry.dispose(); }
    if (!ground || !ground.positions || ground.positions.length === 0) return;
    const src = ground.positions;
    const pos = new Float32Array(src.length);
    for (let i = 0; i < src.length; i += 3) {
      pos[i]     = this._toScene(src[i]);
      pos[i + 1] = 0;
      pos[i + 2] = -this._toScene(src[i + 1]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(ground.colors, 3));
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide,
      transparent: true, opacity: 0.95 });
    this.groundMesh = new THREE.Mesh(geo, mat);
    this.scene.add(this.groundMesh);
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

    const cx = -half, cz = half;
    const amat = new THREE.LineBasicMaterial({ color: 0x55617a });
    const vline = new THREE.BufferGeometry();
    vline.setAttribute('position', new THREE.BufferAttribute(new Float32Array([cx, 0, cz, cx, top, cz]), 3));
    group.add(new THREE.LineSegments(vline, amat));

    for (let kft = 10; kft <= 70; kft += 10) {
      const y = this._toSceneZ(kft * KFT_TO_M);
      if (y > top) break;
      const tick = new THREE.BufferGeometry();
      tick.setAttribute('position', new THREE.BufferAttribute(new Float32Array([cx, y, cz, cx - 6, y, cz]), 3));
      group.add(new THREE.LineSegments(tick, amat));
      const guide = new THREE.BufferGeometry();
      guide.setAttribute('position', new THREE.BufferAttribute(new Float32Array([cx, y, cz, cx, y, -cz, half, y, -cz]), 3));
      group.add(new THREE.Line(guide, new THREE.LineBasicMaterial({ color: 0x222a35 })));
      group.add(this._label(`${kft} kft`, cx - 16, y, cz, 0.7));
    }

    group.add(this._label('WEST',  -half - 10, 0, 0, 1.2));
    group.add(this._label('EAST',   half + 10, 0, 0, 1.2));
    group.add(this._label('SOUTH',  0, 0, half + 10, 1.2));
    group.add(this._label('NORTH',  0, 0, -half - 10, 1.2));

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

  _frameToData(worldPositions) {
    if (!worldPositions || worldPositions.length === 0) return;
    let cx = 0, cz = 0, count = 0, maxR = 0;
    for (let i = 0; i < worldPositions.length; i += 3) {
      cx += this._toScene(worldPositions[i]);
      cz += -this._toScene(worldPositions[i + 1]);
      count++;
    }
    cx /= count; cz /= count;
    for (let i = 0; i < worldPositions.length; i += 3) {
      const dx = this._toScene(worldPositions[i]) - cx;
      const dz = -this._toScene(worldPositions[i + 1]) - cz;
      maxR = Math.max(maxR, Math.hypot(dx, dz));
    }
    const dist = Math.max(60, maxR * 2.6);
    this._home = {
      target: new THREE.Vector3(cx, 20, cz),
      pos: new THREE.Vector3(cx - dist * 0.7, dist * 0.5, cz + dist * 0.8),
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
    this.worker.postMessage({ type: 'product', product, threshold: this.threshold });
  }

  _onThreshold(val) {
    this.threshold = val;
    this._renderThreshReadout();
    clearTimeout(this._remarchTimer);
    this._remarchTimer = setTimeout(() => {
      if (!this.worker) return;
      this._showSpinner('Rebuilding isosurface...');
      this.worker.postMessage({ type: 'remarch', threshold: val });
    }, 220);
  }

  close() {
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
