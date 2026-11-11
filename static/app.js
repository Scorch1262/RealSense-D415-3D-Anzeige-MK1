// RealSense-Viewer-MK1 – Frontend
import * as THREE from 'three';
import { OrbitControls } from '/static/vendor/OrbitControls.js';

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------
// Zustand
// ------------------------------------------------------------------
const S = {
  view: '3d',
  colorMode: 'rgb',
  pointSize: 2,
  minD: 0.15,
  maxD: 3.0,
  grid: true,
  axes: true,
  frozen: false,
  seq: 0,
  last: null,          // letzter geparster Frame
  bytes: 0,
  validCount: 0,
  status: null,
};

// ------------------------------------------------------------------
// Turbo-Farbskala (Näherung) als LUT
// ------------------------------------------------------------------
const TURBO = new Uint8Array(256 * 3);
for (let i = 0; i < 256; i++) {
  const x = i / 255;
  const r = 0.13572138 + x * (4.61539260 + x * (-42.66032258 + x * (132.13108234 + x * (-152.94239396 + x * 59.28637943))));
  const g = 0.09140261 + x * (2.19418839 + x * (4.84296658 + x * (-14.18503333 + x * (4.27729857 + x * 2.82956604))));
  const b = 0.10667330 + x * (12.64194608 + x * (-60.58204836 + x * (110.36276771 + x * (-89.90310912 + x * 27.34824973))));
  TURBO[i * 3] = Math.max(0, Math.min(255, r * 255));
  TURBO[i * 3 + 1] = Math.max(0, Math.min(255, g * 255));
  TURBO[i * 3 + 2] = Math.max(0, Math.min(255, b * 255));
}
const AMBER = [255, 176, 0];
const TEAL = [25, 211, 197];

// ------------------------------------------------------------------
// three.js Szene
// ------------------------------------------------------------------
const pane3d = $('pane3d');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x07090b, 1);
pane3d.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x07090b, 6, 16);
const camera = new THREE.PerspectiveCamera(55, 1, 0.01, 100);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.screenSpacePanning = true;

// Punktwolke
let capacity = 0;
const geom = new THREE.BufferGeometry();
let posAttr, colAttr;
function ensureCapacity(n) {
  if (n <= capacity) return;
  capacity = n;
  posAttr = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
  colAttr = new THREE.BufferAttribute(new Uint8Array(n * 3), 3, true);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  colAttr.setUsage(THREE.DynamicDrawUsage);
  geom.setAttribute('position', posAttr);
  geom.setAttribute('color', colAttr);
}
ensureCapacity(1280 * 720);
geom.setDrawRange(0, 0);
const mat = new THREE.PointsMaterial({ size: 2, vertexColors: true, sizeAttenuation: false });
const points = new THREE.Points(geom, mat);
points.frustumCulled = false;
scene.add(points);

// Raster am Boden + Kamerasymbol
const gridGroup = new THREE.Group();
const grid = new THREE.GridHelper(8, 32, 0x19d3c5, 0x1a2a2c);
grid.position.set(0, -0.6, -4);
grid.material.transparent = true;
grid.material.opacity = 0.35;
gridGroup.add(grid);
scene.add(gridGroup);

const camGroup = new THREE.Group();
{
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.099, 0.023, 0.020),
    new THREE.MeshBasicMaterial({ color: 0x1a2027 }));
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry),
    new THREE.LineBasicMaterial({ color: 0xffb000 }));
  body.add(edges);
  camGroup.add(body);
  // Sichtkegel (D415 ca. 65° x 40°)
  const d = 0.35, hx = Math.tan(32.5 * Math.PI / 180) * d, hy = Math.tan(20 * Math.PI / 180) * d;
  const v = [0, 0, 0, -hx, hy, -d, 0, 0, 0, hx, hy, -d, 0, 0, 0, -hx, -hy, -d, 0, 0, 0, hx, -hy, -d,
    -hx, hy, -d, hx, hy, -d, hx, hy, -d, hx, -hy, -d, hx, -hy, -d, -hx, -hy, -d, -hx, -hy, -d, -hx, hy, -d];
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  camGroup.add(new THREE.LineSegments(fg, new THREE.LineBasicMaterial({ color: 0xffb000, transparent: true, opacity: 0.5 })));
  const ax = new THREE.AxesHelper(0.12);
  camGroup.add(ax);
}
scene.add(camGroup);

const CAM_PRESETS = {
  kamera: { p: [0, 0, 0.12], t: [0, 0, -1.5] },
  schraeg: { p: [1.5, 0.9, 0.9], t: [0, 0, -1.4] },
  oben: { p: [0, 3.2, -1.39], t: [0, 0, -1.4] },
  seite: { p: [3.0, 0.2, -1.4], t: [0, 0, -1.4] },
};
function setCamPreset(name) {
  const c = CAM_PRESETS[name] || CAM_PRESETS.schraeg;
  camera.position.set(...c.p);
  controls.target.set(...c.t);
  controls.update();
}
setCamPreset('schraeg');

function resize3d() {
  const r = pane3d.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return;
  renderer.setSize(r.width, r.height, false);
  renderer.domElement.style.width = r.width + 'px';
  renderer.domElement.style.height = r.height + 'px';
  camera.aspect = r.width / r.height;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize3d).observe(pane3d);

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  if (S.view === '3d' || S.view === 'geteilt') renderer.render(scene, camera);
}
animate();

// ------------------------------------------------------------------
// Frame-Verarbeitung
// ------------------------------------------------------------------
let rays = null, raysKey = '';
function getRays(w, h, fx, fy, ppx, ppy) {
  const key = `${w}x${h}:${fx}:${fy}:${ppx}:${ppy}`;
  if (key === raysKey) return rays;
  const rx = new Float32Array(w * h), ry = new Float32Array(w * h);
  for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) {
    const i = v * w + u;
    rx[i] = (u - ppx) / fx;
    ry[i] = (v - ppy) / fy;
  }
  rays = { rx, ry }; raysKey = key;
  return rays;
}

function parseFrame(buf) {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'RS3D') throw new Error('Ungültiger Frame');
  const f = {
    seq: dv.getUint32(4, true), w: dv.getUint16(8, true), h: dv.getUint16(10, true),
    fx: dv.getFloat32(12, true), fy: dv.getFloat32(16, true),
    ppx: dv.getFloat32(20, true), ppy: dv.getFloat32(24, true),
    units: dv.getFloat32(28, true), flags: dv.getUint32(32, true), fps: dv.getFloat32(36, true),
  };
  const n = f.w * f.h;
  f.depth = new Uint16Array(buf, 40, n);
  f.rgb = (f.flags & 1) ? new Uint8Array(buf, 40 + n * 2, n * 3) : null;
  f.demo = !!(f.flags & 2);
  return f;
}

function buildCloud(f) {
  const n = f.w * f.h;
  ensureCapacity(n);
  const { rx, ry } = getRays(f.w, f.h, f.fx, f.fy, f.ppx, f.ppy);
  const P = posAttr.array, C = colAttr.array;
  const dep = f.depth, rgb = f.rgb, u = f.units;
  const minD = S.minD, maxD = S.maxD, span = Math.max(1e-6, maxD - minD);
  let mode = S.colorMode;
  if (mode === 'rgb' && !rgb) mode = 'tiefe';
  const base = mode === 'teal' ? TEAL : AMBER;
  let k = 0, sumZ = 0;
  for (let i = 0; i < n; i++) {
    const raw = dep[i];
    if (raw === 0) continue;
    const z = raw * u;
    if (z < minD || z > maxD) continue;
    const j = k * 3;
    P[j] = rx[i] * z;
    P[j + 1] = -ry[i] * z;
    P[j + 2] = -z;
    if (mode === 'rgb') {
      const s = i * 3;
      C[j] = rgb[s]; C[j + 1] = rgb[s + 1]; C[j + 2] = rgb[s + 2];
    } else if (mode === 'tiefe') {
      const t = ((1 - (z - minD) / span) * 255) | 0;
      const s = t * 3;
      C[j] = TURBO[s]; C[j + 1] = TURBO[s + 1]; C[j + 2] = TURBO[s + 2];
    } else {
      const b = 1.05 - 0.75 * (z - minD) / span;
      C[j] = base[0] * b; C[j + 1] = base[1] * b; C[j + 2] = base[2] * b;
    }
    sumZ += z;
    k++;
  }
  geom.setDrawRange(0, k);
  posAttr.needsUpdate = true;
  colAttr.needsUpdate = true;
  S.validCount = k;
  return k ? sumZ / k : 0;
}

// 2D-Ansichten
const cvDepth = $('cvDepth'), cvColor = $('cvColor');
const ctxDepth = cvDepth.getContext('2d'), ctxColor = cvColor.getContext('2d');
let imgDepth = null, imgColor = null;

function drawDepth(f) {
  if (cvDepth.width !== f.w || cvDepth.height !== f.h) { cvDepth.width = f.w; cvDepth.height = f.h; imgDepth = null; }
  if (!imgDepth) imgDepth = ctxDepth.createImageData(f.w, f.h);
  const D = imgDepth.data, dep = f.depth, u = f.units;
  const minD = S.minD, span = Math.max(1e-6, S.maxD - S.minD);
  for (let i = 0, n = f.w * f.h; i < n; i++) {
    const raw = dep[i], o = i * 4;
    if (raw === 0) { D[o] = 0; D[o + 1] = 0; D[o + 2] = 0; D[o + 3] = 255; continue; }
    let t = (raw * u - minD) / span;
    if (t < 0 || t > 1) { D[o] = 12; D[o + 1] = 14; D[o + 2] = 17; D[o + 3] = 255; continue; }
    const s = ((1 - t) * 255 | 0) * 3;
    D[o] = TURBO[s]; D[o + 1] = TURBO[s + 1]; D[o + 2] = TURBO[s + 2]; D[o + 3] = 255;
  }
  ctxDepth.putImageData(imgDepth, 0, 0);
}

function drawColor(f) {
  if (!f.rgb) {
    ctxColor.fillStyle = '#07090b'; ctxColor.fillRect(0, 0, cvColor.width, cvColor.height);
    $('hudColor').textContent = 'KEIN FARBSTROM';
    return;
  }
  if (cvColor.width !== f.w || cvColor.height !== f.h) { cvColor.width = f.w; cvColor.height = f.h; imgColor = null; }
  if (!imgColor) imgColor = ctxColor.createImageData(f.w, f.h);
  const D = imgColor.data, src = f.rgb;
  for (let i = 0, n = f.w * f.h; i < n; i++) {
    const o = i * 4, s = i * 3;
    D[o] = src[s]; D[o + 1] = src[s + 1]; D[o + 2] = src[s + 2]; D[o + 3] = 255;
  }
  ctxColor.putImageData(imgColor, 0, 0);
  $('hudColor').textContent = `${f.w}×${f.h} · AUF TIEFE AUSGERICHTET`;
}

// Mauszeiger über Tiefenbild: Distanz anzeigen
let hoverDepth = null;
cvDepth.addEventListener('mousemove', (e) => {
  const f = S.last; if (!f) return;
  const r = cvDepth.getBoundingClientRect();
  const scale = Math.min(r.width / f.w, r.height / f.h);
  const ox = (r.width - f.w * scale) / 2, oy = (r.height - f.h * scale) / 2;
  const u = Math.floor((e.clientX - r.left - ox) / scale), v = Math.floor((e.clientY - r.top - oy) / scale);
  if (u < 0 || v < 0 || u >= f.w || v >= f.h) { hoverDepth = null; return; }
  const raw = f.depth[v * f.w + u];
  hoverDepth = raw ? `PIXEL ${u},${v} · ${(raw * f.units).toFixed(3)} m` : `PIXEL ${u},${v} · KEIN WERT`;
  updateHud();
});
cvDepth.addEventListener('mouseleave', () => { hoverDepth = null; updateHud(); });

let meanZ = 0;
function render(f) {
  S.last = f;
  if (S.view === '3d' || S.view === 'geteilt') meanZ = buildCloud(f);
  if (S.view === 'tiefe' || S.view === 'geteilt') drawDepth(f);
  if (S.view === 'farbe' || S.view === 'geteilt') drawColor(f);
  $('badgeDemo').style.display = f.demo ? 'block' : 'none';
  $('noSignal').style.display = 'none';
  updateHud();
}

function updateHud() {
  const f = S.last; if (!f) return;
  $('hud3d').textContent = `PUNKTE ${S.validCount.toLocaleString('de-DE')} · Ø ${meanZ.toFixed(2)} m · BEREICH ${S.minD.toFixed(2)}–${S.maxD.toFixed(2)} m`;
  $('hudDepth').textContent = hoverDepth || `${f.w}×${f.h} · ${S.minD.toFixed(2)}–${S.maxD.toFixed(2)} m`;
  $('pillFps').textContent = `${f.fps.toFixed(1)} FPS`;
}

// ------------------------------------------------------------------
// Datenabruf (Long-Polling)
// ------------------------------------------------------------------
async function frameLoop() {
  let failures = 0;
  for (;;) {
    if (S.frozen) { await sleep(150); continue; }
    try {
      const r = await fetch(`/api/frame?nach=${S.seq}`, { cache: 'no-store' });
      if (r.status === 204) { failures = 0; continue; }
      if (!r.ok) throw new Error(r.status);
      const buf = await r.arrayBuffer();
      S.bytes += buf.byteLength;
      const f = parseFrame(buf);
      S.seq = f.seq;
      if (!S.frozen) render(f);
      failures = 0;
    } catch (e) {
      failures++;
      if (failures > 2) {
        $('noSignal').style.display = 'flex';
        $('noSignalText').textContent = 'Keine Verbindung zum Programm – läuft die exe noch?';
      }
      await sleep(1000);
    }
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

setInterval(() => {
  $('sbRate').textContent = `${(S.bytes / 1024).toFixed(0)} KB/s`;
  S.bytes = 0;
}, 1000);
setInterval(() => { $('clock').textContent = new Date().toLocaleTimeString('de-DE'); }, 1000);

// ------------------------------------------------------------------
// Status & Einstellungen
// ------------------------------------------------------------------
let settingsLoaded = false;
async function pollStatus() {
  try {
    const st = await (await fetch('/api/status', { cache: 'no-store' })).json();
    S.status = st;
    applyStatus(st);
    if (!settingsLoaded) { loadSettings(st); settingsLoaded = true; }
  } catch (e) {
    setPill('err', 'OFFLINE');
    $('sbMsg').textContent = 'Keine Verbindung zum Programm';
  }
}

function setPill(cls, text) {
  const p = $('pillCam');
  p.className = 'pill ' + cls;
  $('pillCamText').textContent = text;
}

function applyStatus(st) {
  if (st.verbunden) setPill('ok', 'VERBUNDEN');
  else if (st.demo) setPill('demo', 'DEMO');
  else setPill('err', 'GETRENNT');
  const g = st.geraet || {};
  $('devName').textContent = g.name || '—';
  $('devSerial').textContent = g.seriennummer || '—';
  $('devFw').textContent = g.firmware || '—';
  $('devUsb').textContent = g.usb ? (g.usb + (g.usb.startsWith('2') ? ' ⚠' : '')) : '—';
  $('devStream').textContent = st.aufloesung || '—';
  $('devTemp').textContent = st.temperatur != null ? `${st.temperatur} °C` : '—';
  $('devSdk').textContent = st.sdk || (st.sdk_fehler ? 'FEHLT' : '—');
  $('sbMsg').textContent = st.meldung || '';
  $('lblPortActive').textContent = `aktiv: ${st.port_aktiv}`;
  $('cfgPath').textContent = st.config_pfad ? `Konfig: ${st.config_pfad}` : '';

  const o = st.optionen || {};
  const hasOpt = st.verbunden && Object.keys(o).length > 0;
  $('camOptions').classList.toggle('disabled', !hasOpt);
  $('camHint').style.display = hasOpt ? 'none' : 'block';
  if (hasOpt && !laserDragging) {
    if ('laser' in o) $('chkLaser').checked = o.laser;
    if ('laserleistung' in o) {
      const r = $('rngLaser');
      r.min = o.laserleistung_min; r.max = o.laserleistung_max; r.step = o.laserleistung_step || 30;
      r.value = o.laserleistung;
      $('lblLaser').textContent = `${Math.round(o.laserleistung)} mW`;
    }
    if (o.presets) {
      const sel = $('selPreset');
      const cur = Array.from(sel.options).map((x) => x.value).join('|');
      if (cur !== o.presets.join('|')) sel.innerHTML = o.presets.map((p) => `<option>${esc(p)}</option>`).join('');
      if (document.activeElement !== sel) sel.value = o.preset;
    }
  }
  if (!st.verbunden && !st.demo && !S.frozen) {
    $('noSignal').style.display = 'flex';
    $('noSignalText').textContent = st.meldung || 'Warte auf Kamera …';
  }
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const yes = (v) => ['ja', '1', 'true', 'an', 'yes'].includes(String(v).toLowerCase());

function loadSettings(st) {
  const e = st.einstellungen;
  $('selRes').innerHTML = st.aufloesungen.map((r) => `<option value="${r}">${r.replace('x', ' × ')}</option>`).join('');
  $('selFps').innerHTML = st.fps_werte.map((r) => `<option value="${r}">${r} fps</option>`).join('');
  $('selRes').value = e.kamera.aufloesung;
  $('selFps').value = e.kamera.fps;
  $('selMode').value = e.kamera.demo_modus;
  segSet('segStep', e.verarbeitung.punktabstand);
  $('chkSpatial').checked = yes(e.verarbeitung.spatial_filter);
  $('chkTemporal').checked = yes(e.verarbeitung.temporal_filter);
  $('chkHoles').checked = yes(e.verarbeitung.loecher_fuellen);
  S.minD = parseFloat(e.verarbeitung.min_distanz_m) || 0.15;
  S.maxD = parseFloat(e.verarbeitung.max_distanz_m) || 3;
  $('rngMin').value = S.minD; $('rngMax').value = S.maxD;
  S.colorMode = e.ansicht.farbmodus; segSet('segColor', S.colorMode);
  S.pointSize = parseFloat(e.ansicht.punktgroesse) || 2; $('rngSize').value = S.pointSize;
  S.grid = yes(e.ansicht.gitter); $('chkGrid').checked = S.grid;
  S.axes = yes(e.ansicht.achsen); $('chkAxes').checked = S.axes;
  $('inpPort').value = e.server.port;
  setView(e.ansicht.ansicht || '3d', false);
  applyLocal();
}

function applyLocal() {
  mat.size = S.pointSize * Math.min(window.devicePixelRatio, 2);
  gridGroup.visible = S.grid;
  camGroup.visible = S.axes;
  $('lblMin').textContent = `${S.minD.toFixed(2)} m`;
  $('lblMax').textContent = `${S.maxD.toFixed(1)} m`;
  $('lblSize').textContent = `${S.pointSize.toFixed(1)} px`;
  $('cbMax').textContent = `${S.minD.toFixed(2)} m`;
  $('cbMin').textContent = `${S.maxD.toFixed(1)} m`;
  $('colorbar').style.display = S.colorMode === 'tiefe' ? 'flex' : 'none';
  if (S.last && S.frozen) render(S.last);
}

const pending = {};
let saveTimer = null;
function save(section, key, value, immediate = false) {
  (pending[section] ||= {})[key] = value;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, immediate ? 0 : 350);
}
async function flushSave() {
  const body = JSON.stringify(pending);
  for (const k of Object.keys(pending)) delete pending[k];
  try {
    const r = await (await fetch('/api/einstellungen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).json();
    if (!r.ok) toast(r.fehler || 'Fehler beim Speichern', true);
    else if (r.neustart_kamera) toast('Kamera wird mit neuen Einstellungen neu gestartet …');
    else if (r.port_neustart) toast('Port gespeichert – wird nach Neustart des Programms aktiv', true);
  } catch (e) { toast('Speichern fehlgeschlagen', true); }
}

function segSet(id, v) {
  document.querySelectorAll(`#${id} button`).forEach((b) => b.classList.toggle('active', b.dataset.v === String(v)));
}
function segBind(id, fn) {
  document.querySelectorAll(`#${id} button`).forEach((b) => b.addEventListener('click', () => { segSet(id, b.dataset.v); fn(b.dataset.v); }));
}

function setView(v, persist = true) {
  S.view = v;
  $('stage').className = 'stage view-' + v;
  document.querySelectorAll('#viewTabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  requestAnimationFrame(resize3d);
  if (S.last) render(S.last);
  if (persist) save('ansicht', 'ansicht', v);
}

// ------------------------------------------------------------------
// Bedienelemente
// ------------------------------------------------------------------
document.querySelectorAll('#viewTabs button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
$('selRes').addEventListener('change', (e) => save('kamera', 'aufloesung', e.target.value, true));
$('selFps').addEventListener('change', (e) => save('kamera', 'fps', e.target.value, true));
$('selMode').addEventListener('change', (e) => save('kamera', 'demo_modus', e.target.value, true));
$('chkLaser').addEventListener('change', (e) => save('kamera', 'laser', e.target.checked, true));
let laserDragging = false;
$('rngLaser').addEventListener('input', (e) => { laserDragging = true; $('lblLaser').textContent = `${e.target.value} mW`; });
$('rngLaser').addEventListener('change', (e) => { save('kamera', 'laserleistung', e.target.value, true); setTimeout(() => (laserDragging = false), 1500); });
$('selPreset').addEventListener('change', (e) => save('kamera', 'preset', e.target.value, true));
$('btnCamRestart').addEventListener('click', async () => { await fetch('/api/kamera/neustart', { method: 'POST' }); toast('Kamera wird neu verbunden …'); });

segBind('segStep', (v) => save('verarbeitung', 'punktabstand', v, true));
$('chkSpatial').addEventListener('change', (e) => save('verarbeitung', 'spatial_filter', e.target.checked));
$('chkTemporal').addEventListener('change', (e) => save('verarbeitung', 'temporal_filter', e.target.checked));
$('chkHoles').addEventListener('change', (e) => save('verarbeitung', 'loecher_fuellen', e.target.checked));
$('rngMin').addEventListener('input', (e) => {
  S.minD = Math.min(parseFloat(e.target.value), S.maxD - 0.1); applyLocal(); updateHud();
  save('verarbeitung', 'min_distanz_m', S.minD.toFixed(2));
});
$('rngMax').addEventListener('input', (e) => {
  S.maxD = Math.max(parseFloat(e.target.value), S.minD + 0.1); applyLocal(); updateHud();
  save('verarbeitung', 'max_distanz_m', S.maxD.toFixed(1));
});

segBind('segColor', (v) => { S.colorMode = v; applyLocal(); if (S.last) render(S.last); save('ansicht', 'farbmodus', v); });
$('rngSize').addEventListener('input', (e) => { S.pointSize = parseFloat(e.target.value); applyLocal(); save('ansicht', 'punktgroesse', S.pointSize); });
$('chkGrid').addEventListener('change', (e) => { S.grid = e.target.checked; applyLocal(); save('ansicht', 'gitter', S.grid); });
$('chkAxes').addEventListener('change', (e) => { S.axes = e.target.checked; applyLocal(); save('ansicht', 'achsen', S.axes); });
segBind('segCam', (v) => { setCamPreset(v); setTimeout(() => segSet('segCam', ''), 600); });

$('btnFreeze').addEventListener('click', () => {
  S.frozen = !S.frozen;
  $('btnFreeze').classList.toggle('on', S.frozen);
  $('btnFreeze').textContent = S.frozen ? 'Fortsetzen' : 'Einfrieren';
  $('badgeFrozen').style.display = S.frozen ? 'block' : 'none';
});

$('btnShot').addEventListener('click', () => {
  let canvas;
  if (S.view === 'tiefe') canvas = cvDepth;
  else if (S.view === 'farbe') canvas = cvColor;
  else { renderer.render(scene, camera); canvas = renderer.domElement; }
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = `realsense_${stamp()}.png`;
  a.click();
});

$('btnPly').addEventListener('click', () => {
  const f = S.last;
  if (!f) return toast('Noch keine Daten', true);
  // Immer die aktuelle Wolke (inkl. Distanzfilter) exportieren
  buildCloud(f);
  const n = S.validCount;
  if (!n) return toast('Keine Punkte im Bereich', true);
  const header = 'ply\nformat binary_little_endian 1.0\n' +
    `comment ${'RealSense-Viewer-MK1'} - Einheit Meter, Y nach oben, Kamera blickt in -Z\n` +
    `element vertex ${n}\nproperty float x\nproperty float y\nproperty float z\n` +
    'property uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n';
  const hb = new TextEncoder().encode(header);
  const out = new ArrayBuffer(hb.length + n * 15);
  new Uint8Array(out).set(hb, 0);
  const dv = new DataView(out);
  const P = posAttr.array, C = colAttr.array;
  let o = hb.length;
  for (let i = 0; i < n; i++) {
    dv.setFloat32(o, P[i * 3], true); dv.setFloat32(o + 4, P[i * 3 + 1], true); dv.setFloat32(o + 8, P[i * 3 + 2], true);
    dv.setUint8(o + 12, C[i * 3]); dv.setUint8(o + 13, C[i * 3 + 1]); dv.setUint8(o + 14, C[i * 3 + 2]);
    o += 15;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([out], { type: 'application/octet-stream' }));
  a.download = `punktwolke_${stamp()}.ply`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast(`${n.toLocaleString('de-DE')} Punkte gespeichert`);
});

$('btnPort').addEventListener('click', () => {
  const p = parseInt($('inpPort').value, 10);
  if (!(p >= 1 && p <= 65535)) return toast('Ungültiger Port', true);
  save('server', 'port', p, true);
});

$('btnMenu').addEventListener('click', () => $('sidebar').classList.toggle('open'));
pane3d.addEventListener('pointerdown', () => $('sidebar').classList.remove('open'));

function stamp() {
  const d = new Date(), z = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
}
let toastTimer = null;
function toast(msg, warn = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (warn ? ' warn' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast' + (warn ? ' warn' : '')), 2600);
}

// Start
pollStatus();
setInterval(pollStatus, 1000);
frameLoop();
