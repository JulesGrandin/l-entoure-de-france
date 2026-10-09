const fmt = new Intl.NumberFormat("fr-FR");
const fmt1 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtCompact = new Intl.NumberFormat("fr-FR", {
  notation: "compact",
  compactDisplay: "short",
  maximumFractionDigits: 1,
});

const els = {
  chrome: document.querySelector("#chrome"),
  introModal: document.querySelector("#intro-modal"),
  scoreHistoryWrap: document.querySelector("#score-history-wrap"),
  scoreHistory: document.querySelector("#score-history"),
  roundScoreBanner: document.querySelector("#round-score-banner"),
  roundScoreBannerValue: document.querySelector("#round-score-banner-value"),
  loadOverlay: document.querySelector("#load-overlay"),
  loadBar: document.querySelector("#load-bar"),
  loadBarFill: document.querySelector("#load-bar-fill"),
  finishModal: document.querySelector("#finish-modal"),
  finishRecap: document.querySelector("#finish-recap"),
  modeRandom: document.querySelector("#mode-random"),
  modeGrid: document.querySelector("#mode-grid"),
  modeNote: document.querySelector("#mode-note"),
  modeRandomFinish: document.querySelector("#mode-random-finish"),
  modeGridFinish: document.querySelector("#mode-grid-finish"),
  modeNoteFinish: document.querySelector("#mode-note-finish"),
  btnStart: document.querySelector("#btn-start"),
  roundKicker: document.querySelector("#round-kicker"),
  targetLabel: document.querySelector("#target-label"),
  timerBlock: document.querySelector("#timer-block"),
  timerFill: document.querySelector("#timer-fill"),
  timerValue: document.querySelector("#timer-value"),
  timerBar: document.querySelector("#timer-block .timer-bar"),
  roundResultSheet: document.querySelector("#round-result-sheet"),
  resultSection: document.querySelector("#result-section"),
  resActual: document.querySelector("#res-actual"),
  resDiffPop: document.querySelector("#res-diff-pop"),
  resDiffPct: document.querySelector("#res-diff-pct"),
  resCount: document.querySelector("#res-count"),
  statsZoneLabel: document.querySelector("#stats-zone-label"),
  drawActions: document.querySelector("#draw-actions"),
  btnClear: document.querySelector("#btn-clear"),
  btnValidate: document.querySelector("#btn-validate"),
  btnNext: document.querySelector("#btn-next"),
  btnPerfectZone: document.querySelector("#btn-perfect-zone"),
  finalScore: document.querySelector("#final-score"),
  btnReplay: document.querySelector("#btn-replay"),
  status: document.querySelector("#status"),
  departments: document.querySelector("#departments"),
  communes: document.querySelector("#communes"),
  cities: document.querySelector("#cities"),
};

let introDismissed = false;

const game = {
  phase: "idle",
  round: 0,
  targets: [],
  roundScores: [],
  roundResults: [],
  selectionIds: [],
  sketchRing: null,
  drawing: false,
  stroke: [],
  roundEndsAt: 0,
  timerRaf: null,
  validatedThisRound: false,
};

const loader = {
  progress: 0,
  set(value) {
    this.progress = Math.min(100, Math.max(this.progress, value));
    const pct = Math.round(this.progress);
    els.loadBarFill.style.width = `${pct}%`;
    els.loadBar.setAttribute("aria-valuenow", String(pct));
  },
  hide() {
    els.loadOverlay.classList.add("is-done");
    els.loadOverlay.setAttribute("aria-busy", "false");
    window.setTimeout(() => {
      els.loadOverlay.hidden = true;
    }, 480);
  },
};

loader.set(6);

async function fetchJsonWithProgress(url, onRatio) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} (${res.status})`);
  const total = Number(res.headers.get("Content-Length")) || 0;
  if (!total || !res.body?.getReader) {
    onRatio(0.15);
    const data = await res.json();
    onRatio(1);
    return data;
  }
  const reader = res.body.getReader();
  let loaded = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    loaded += value.byteLength;
    chunks.push(value);
    onRatio(loaded / total);
  }
  onRatio(1);
  const merged = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(merged));
}

proj4.defs(
  "EPSG:2154",
  "+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs"
);

const MAP_R = 6378137;
const MAP_M_PER_DEG = (MAP_R * Math.PI) / 180;

function lonLatToMap(lon, lat) {
  const [x, y] = proj4("EPSG:4326", "EPSG:2154", [lon, lat]);
  const lng = (x - 700000) / MAP_M_PER_DEG;
  const merc = (y - 6600000) / MAP_R;
  return [lng, ((2 * Math.atan(Math.exp(merc)) - Math.PI / 2) * 180) / Math.PI];
}

const FRANCE_BOUNDS = [
  [-5.4, -4.97],
  [4.88, 4.59],
];

const map = new maplibregl.Map({
  container: "map",
  canvasContextAttributes: { alpha: true },
  style: {
    version: 8,
    sources: {},
    layers: [{ id: "bg", type: "background", paint: { "background-color": "rgba(0, 0, 0, 0)" } }],
  },
  bounds: FRANCE_BOUNDS,
  fitBoundsOptions: { padding: 28 },
  attributionControl: false,
  maxZoom: 13,
  minZoom: 0,
});

map.addControl(
  new maplibregl.AttributionControl({
    customAttribution:
      'Projection Lambert 93 (<a href="https://observablehq.com/@ericmauviere/le-fond-de-carte-simplifie-des-communes-2021-avec-droms-rapp" target="_blank" rel="noopener noreferrer">merci Eric Mauvière</a>), Communes 2026 IGN, Population 2023 Insee',
  }),
  "bottom-right"
);

map.scrollZoom.disable();
map.boxZoom.disable();
map.doubleClickZoom.disable();
map.touchZoomRotate.disable();
map.dragRotate.disable();
map.keyboard.disable();
map.dragPan.disable();

const TIMER_BAR_PX = 13;
const TIMER_BAR_PX_MOBILE = 11;

function activeTimerHeight() {
  const reserveTimer =
    document.body.classList.contains("is-playing") ||
    document.body.classList.contains("is-intro");
  if (!reserveTimer) return 0;
  const w = map.getContainer()?.clientWidth || window.innerWidth;
  return w <= 520 ? TIMER_BAR_PX_MOBILE : TIMER_BAR_PX;
}

function mapPadding() {
  const el = map.getContainer();
  const w = el.clientWidth || window.innerWidth;
  const h = el.clientHeight || window.innerHeight;
  const inset = Math.max(10, Math.round(Math.min(w, h) * 0.022));
  const mobile = w <= 520;
  const timerTop = activeTimerHeight();
  const hudBottom = mobile ? 46 : 14;
  return {
    top: inset + timerTop,
    left: inset,
    right: inset,
    bottom: inset + hudBottom,
  };
}

function refitMap() {
  map.resize();
  map.fitBounds(FRANCE_BOUNDS, { padding: mapPadding(), duration: 0 });
  paintZones();
  updateSketchLayer();
}

function frameFrance(force = false) {
  const box = map.getContainer();
  const size = `${box.clientWidth}x${box.clientHeight}`;
  const key = size;
  if (!force && key === frameFrance.key) return false;
  frameFrance.key = key;
  refitMap();
  return true;
}

function scheduleRefit() {
  requestAnimationFrame(() => frameFrance(true));
}

new ResizeObserver(() => frameFrance(true)).observe(map.getContainer());

const MAJOR_CITY_CODES = new Set(["75056", "13055", "69123"]);
const CITY_CODES = [
  "75056", "13055", "69123", "31555", "06088",
  "44109", "34172", "67482", "33063", "59350",
  "35238", "51454", "42218", "76351",
  "29019", "21231", "87085", "45234", "54395",
];

const ROUND_TIME_MS = 15_000;

/** Une manche « facile » (~100–200 k hab.), les quatre autres ≥ 400 k. */
const SMALL_TARGETS = [100_000, 125_000, 150_000, 175_000, 200_000];

const LARGE_TARGETS = [
  400_000, 500_000, 750_000, 1_000_000, 1_500_000, 2_000_000, 3_000_000, 4_000_000,
  5_000_000, 6_000_000, 8_000_000, 10_000_000, 12_000_000, 15_000_000, 18_000_000,
  22_000_000, 25_000_000, 30_000_000,
];

/** Score sur 20 : erreur relative linéaire (0 % → 20, 25 % → 15, 50 % → 10, 100 %+ → 0). */
function scoreForRound(target, actual) {
  if (!target || target <= 0) return 0;
  const err = Math.min(1, Math.abs(actual - target) / target);
  return Math.round(20 * (1 - err));
}

const fmtMillions = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

/** Objectif affiché : « millions » en toutes lettres (pluriel à partir de 2 M). */
function formatPopTarget(n) {
  if (n >= 1_000_000) {
    const num = fmtMillions.format(n / 1_000_000).replace(/\s/g, "\u202f");
    const word = n >= 2_000_000 ? "millions" : "million";
    return `${num} ${word} d'habitants`;
  }
  return `${fmt.format(n)} habitants`;
}

function formatPop(n) {
  return formatPopTarget(n);
}

function formatPopShort(n) {
  return `${fmt.format(n)} hab.`;
}

function formatPopCount(n) {
  return `${fmt.format(n)} habitants`;
}

function formatDiffPopulation(diff) {
  if (diff === 0) return "0 habitant d'écart";
  const n = fmt.format(Math.abs(diff));
  if (diff > 0) return `${n} habitants en trop`;
  return `${n} habitants en moins`;
}

function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickOne(arr, rng = Math.random) {
  return arr[Math.floor(rng() * arr.length)];
}

function buildRoundTargets(rng = Math.random) {
  const small = pickOne(SMALL_TARGETS, rng);
  const large = shuffle(LARGE_TARGETS, rng).slice(0, 4);
  return shuffle([small, ...large], rng);
}

function randomTargets() {
  return buildRoundTargets();
}

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gridTargetsForDate(date = new Date()) {
  const msWeek = 7 * 24 * 3600 * 1000;
  const weekIndex = Math.floor(date.getTime() / msWeek);
  return buildRoundTargets(mulberry32(weekIndex));
}

let gameMode = "random";
let index = null;
let features = null;
let cityMarkers = [];

function communeMapCoord(i) {
  return lonLatToMap(index.lon[i], index.lat[i]);
}

function ringContains(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function communesInRing(ring) {
  const ids = [];
  for (let i = 0; i < index.pop.length; i++) {
    const [lng, lat] = communeMapCoord(i);
    if (ringContains(ring, lng, lat)) ids.push(i);
  }
  return ids;
}

function populationForIds(ids) {
  let pop = 0;
  for (const i of ids) pop += index.pop[i];
  return pop;
}

function indicesSortedByDistanceFrom(seed) {
  const n = index.pop.length;
  const lon0 = index.lon[seed];
  const lat0 = index.lat[seed];
  const indices = new Array(n);
  for (let i = 0; i < n; i++) indices[i] = i;
  indices.sort((a, b) => {
    const da = (index.lon[a] - lon0) ** 2 + (index.lat[a] - lat0) ** 2;
    const db = (index.lon[b] - lon0) ** 2 + (index.lat[b] - lat0) ** 2;
    return da - db;
  });
  return indices;
}

function refineCommuneSubset(ids, target, pool) {
  const set = new Set(ids);
  let sum = populationForIds(ids);

  for (let iter = 0; iter < 320; iter++) {
    const currentPts = scoreForRound(target, sum);
    const currentDiff = Math.abs(sum - target);
    let best = null;

    for (const i of set) {
      if (set.size <= 1) break;
      const ns = sum - index.pop[i];
      const pts = scoreForRound(target, ns);
      const diff = Math.abs(ns - target);
      if (pts > currentPts || (pts === currentPts && diff < currentDiff)) {
        best = { type: "remove", i, sum: ns, pts, diff };
      }
    }
    for (const i of pool) {
      if (set.has(i)) continue;
      const ns = sum + index.pop[i];
      const pts = scoreForRound(target, ns);
      const diff = Math.abs(ns - target);
      if (
        !best ||
        pts > best.pts ||
        (pts === best.pts && diff < best.diff)
      ) {
        best = { type: "add", i, sum: ns, pts, diff };
      }
    }
    if (!best) break;
    if (best.pts < currentPts) break;
    if (best.pts === currentPts && best.diff >= currentDiff) break;

    if (best.type === "add") set.add(best.i);
    else set.delete(best.i);
    sum = best.sum;
    if (scoreForRound(target, sum) === 20) break;
  }

  return { ids: [...set], sum };
}

function greedySubsetFromOrder(order, target) {
  const ids = [];
  let sum = 0;
  for (const i of order) {
    const p = index.pop[i];
    if (!p) continue;
    const next = sum + p;
    if (ids.length > 0 && next > target * 1.035 && sum >= target * 0.965) continue;
    if (ids.length > 0 && next > target * 1.18) continue;
    ids.push(i);
    sum = next;
  }
  const pool = order.slice(0, Math.min(900, order.length));
  return refineCommuneSubset(ids, target, pool);
}

function generatePerfectZone(target) {
  const n = index.pop.length;
  let best = { ids: [], sum: 0, pts: -1, diff: Infinity };

  for (let t = 0; t < 18; t++) {
    let built;
    if (t % 3 === 2) {
      const near = indicesSortedByDistanceFrom(Math.floor(Math.random() * n)).slice(0, 700);
      shuffle(near);
      built = greedySubsetFromOrder(near, target);
    } else {
      built = greedySubsetFromOrder(indicesSortedByDistanceFrom(Math.floor(Math.random() * n)), target);
    }
    const pts = scoreForRound(target, built.sum);
    const diff = Math.abs(built.sum - target);
    if (pts > best.pts || (pts === best.pts && diff < best.diff)) {
      best = { ...built, pts, diff };
    }
    if (best.pts === 20) break;
  }

  return best;
}

function ringForCommuneIds(ids) {
  if (!ids.length) return null;
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const i of ids) {
    const [lng, lat] = communeMapCoord(i);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  const padLng = Math.max(0.012, (maxLng - minLng) * 0.08 + 0.008);
  const padLat = Math.max(0.012, (maxLat - minLat) * 0.08 + 0.008);
  return [
    [minLng - padLng, minLat - padLat],
    [maxLng + padLng, minLat - padLat],
    [maxLng + padLng, maxLat + padLat],
    [minLng - padLng, maxLat + padLat],
    [minLng - padLng, minLat - padLat],
  ];
}

function updateResultStatsDisplay(actual, ids, target, { updateScore = true } = {}) {
  const diff = actual - target;
  const diffPct = target ? (100 * diff) / target : 0;
  if (updateScore) {
    els.roundScoreBannerValue.textContent = String(scoreForRound(target, actual));
  }
  els.resActual.textContent = formatPopCount(actual);
  els.resCount.textContent = fmt.format(ids.length);
  els.resDiffPop.textContent = formatDiffPopulation(diff);
  els.resDiffPct.textContent = `${fmt1.format(Math.abs(diffPct))}\u00a0%`;
}

function showPerfectZonePreview() {
  if (game.phase !== "result" || !index) return;
  const target = game.targets[game.round];
  const { ids, sum } = generatePerfectZone(target);
  if (!ids.length) return;

  game.selectionIds = ids;
  paintZones();

  game.sketchRing = null;
  game.stroke = [];
  game.drawing = false;
  updateSketchLayer();
  setSketchCursor(false);
  for (const id of ["sketch-line", "sketch-fill", "sketch-outline"]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
  }

  els.statsZoneLabel.textContent = "Zone parfaite";
  updateResultStatsDisplay(sum, ids, target, { updateScore: false });
}

function simplifyStroke(points, minDistPx = 5) {
  if (points.length < 2) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = map.project(out[out.length - 1]);
    const b = map.project(points[i]);
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    if (dx * dx + dy * dy >= minDistPx * minDistPx) out.push(points[i]);
  }
  return out;
}

function strokeSimplifyMovePx() {
  return window.innerWidth <= 520 ? 2 : 4;
}

function strokeSimplifyEndPx() {
  return window.innerWidth <= 520 ? 3 : 6;
}

function strokeCloseThresholdPx() {
  return window.innerWidth <= 520 ? 32 : 12;
}

function closedRingFromStroke(stroke) {
  if (stroke.length < 3) return null;
  const ring = stroke.slice();
  const first = ring[0];
  const last = ring[ring.length - 1];
  const a = map.project(first);
  const b = map.project(last);
  const closePx = strokeCloseThresholdPx();
  if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 > closePx * closePx) ring.push(first);
  return ring.length >= 4 ? ring : null;
}

function updateSketchLayer() {
  if (!map.getSource("sketch")) return;
  const line = game.stroke.length >= 2 ? game.stroke : [];
  const polygon =
    game.sketchRing && game.sketchRing.length >= 4
      ? { type: "Polygon", coordinates: [game.sketchRing] }
      : null;
  map.getSource("sketch").setData({
    type: "FeatureCollection",
    features: [
      ...(line.length >= 2
        ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: line } }]
        : []),
      ...(polygon
        ? [{ type: "Feature", properties: {}, geometry: polygon }]
        : []),
    ],
  });
  positionDrawActions();
}

function clearSketch() {
  game.stroke = [];
  game.sketchRing = null;
  game.drawing = false;
  setSketchCursor(false);
  updateSketchLayer();
  setDrawUi(false);
}

function setDrawUi(enabled) {
  const ready = enabled && !!game.sketchRing;
  els.btnClear.disabled = !ready;
  els.btnValidate.disabled = !ready;
  if (ready) {
    els.drawActions.removeAttribute("hidden");
    positionDrawActions();
  } else {
    els.drawActions.setAttribute("hidden", "");
    els.drawActions.style.visibility = "hidden";
  }
}

function sketchScreenBounds() {
  if (!map || !game.sketchRing?.length) return null;
  const ring = game.sketchRing;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const lngLat of ring) {
    const p = map.project(lngLat);
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const rect = map.getCanvas().getBoundingClientRect();
  return {
    top: rect.top + minY,
    bottom: rect.top + maxY,
    centerX: rect.left + (minX + maxX) / 2,
  };
}

function positionDrawActions() {
  const row = els.drawActions;
  if (!row || row.hasAttribute("hidden") || game.phase !== "draw") {
    if (row) row.style.visibility = "hidden";
    return;
  }
  const bounds = sketchScreenBounds();
  if (!bounds) {
    row.style.visibility = "hidden";
    return;
  }
  row.style.visibility = "visible";
  const gap = 12;
  const margin = 16;
  const h = row.offsetHeight || 44;
  const w = row.offsetWidth || 200;
  const spaceBelow = window.innerHeight - bounds.bottom - gap;
  const spaceAbove = bounds.top - gap;
  const placeBelow = spaceBelow >= h + margin || spaceBelow >= spaceAbove;
  const top = placeBelow ? bounds.bottom + gap : bounds.top - gap - h;
  let centerX = bounds.centerX;
  centerX = Math.max(margin + w / 2, Math.min(window.innerWidth - margin - w / 2, centerX));
  row.style.left = `${centerX}px`;
  row.style.top = `${Math.max(margin, Math.min(window.innerHeight - margin - h, top))}px`;
  row.style.transform = "translateX(-50%)";
}

function setSketchCursor(active) {
  map.getCanvas().classList.toggle("is-sketching", active);
}

function setIntroMapView() {
  document.body.classList.add("is-intro");
  document.body.classList.remove("is-playing");
  const hide = ["communes-line", "departements-line", "zone", "sketch-line", "sketch-fill", "sketch-outline"];
  for (const id of hide) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
  }
}

function ensureSketchLayersForDraw() {
  for (const id of ["sketch-line", "sketch-fill", "sketch-outline"]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "visible");
  }
}

function setGameMapView() {
  document.body.classList.remove("is-intro");
  document.body.classList.add("is-playing");
  if (map.getLayer("zone")) map.setLayoutProperty("zone", "visibility", "visible");
  ensureSketchLayersForDraw();
  setDepartmentsVisible(els.departments.checked);
  setCommunesVisible(els.communes.checked);
}

function dismissIntro() {
  if (introDismissed) return;
  introDismissed = true;
  els.introModal.setAttribute("hidden", "");
  els.chrome.removeAttribute("hidden");
  setGameMapView();
  scheduleRefit();
}

const ROUND_COUNT = 5;

function renderScoreHistory() {
  els.scoreHistory.innerHTML = "";
  for (let i = 0; i < ROUND_COUNT; i++) {
    const li = document.createElement("li");
    const r = game.roundResults[i];
    if (r) {
      li.textContent = `Manche ${i + 1} — ${r.pts}/20`;
    } else if (i === game.round && game.phase !== "idle" && game.phase !== "done") {
      li.className = "score-history-current";
      li.textContent = `Manche ${i + 1} — En cours`;
    } else {
      li.className = "score-history-empty";
      li.textContent = `Manche ${i + 1} — À venir`;
    }
    els.scoreHistory.appendChild(li);
  }
  const total = game.roundScores.reduce((a, b) => a + b, 0);
  const totalLi = document.createElement("li");
  totalLi.className = "score-history-total";
  totalLi.textContent = `Total : ${total}/100`;
  els.scoreHistory.appendChild(totalLi);
}

function stopRoundTimer() {
  if (game.timerRaf) {
    cancelAnimationFrame(game.timerRaf);
    game.timerRaf = null;
  }
  document.body.classList.remove("has-timer");
}

function startRoundTimer() {
  stopRoundTimer();
  game.roundEndsAt = Date.now() + ROUND_TIME_MS;
  document.body.classList.add("has-timer");
  els.timerBlock.removeAttribute("hidden");
  els.timerFill.style.width = "100%";
  els.timerBar.setAttribute("aria-valuenow", "100");
  els.timerValue.textContent = `${Math.round(ROUND_TIME_MS / 1000)} s`;
  tickRoundTimer();
}

function tickRoundTimer() {
  if (game.phase !== "draw") return;
  const left = game.roundEndsAt - Date.now();
  if (left <= 0) {
    onRoundTimeout();
    return;
  }
  const pct = (left / ROUND_TIME_MS) * 100;
  const pctClamped = Math.max(0, Math.min(100, pct));
  els.timerFill.style.width = `${pctClamped}%`;
  els.timerBar.setAttribute("aria-valuenow", String(Math.round(pctClamped)));
  els.timerValue.textContent = `${Math.max(0, Math.ceil(left / 1000))} s`;
  game.timerRaf = requestAnimationFrame(tickRoundTimer);
}

function onRoundTimeout() {
  stopRoundTimer();
  if (game.phase !== "draw") return;
  clearSketch();
  applyRoundResult({ pts: 0, actual: 0, ids: [], timedOut: true });
}

function modeNoteText() {
  if (gameMode === "random") {
    return "Cinq objectifs tirés au hasard, dans un ordre imprévisible.";
  }
  const t = gridTargetsForDate();
  return `Grille de la quinzaine : ${t.map((n) => fmtCompact.format(n)).join(" → ")}.`;
}

function syncModeUi() {
  const random = gameMode === "random";
  els.modeRandom.setAttribute("aria-pressed", random ? "true" : "false");
  els.modeGrid.setAttribute("aria-pressed", random ? "false" : "true");
  if (els.modeRandomFinish) {
    els.modeRandomFinish.setAttribute("aria-pressed", random ? "true" : "false");
    els.modeGridFinish.setAttribute("aria-pressed", random ? "false" : "true");
  }
  const note = modeNoteText();
  els.modeNote.textContent = note;
  if (els.modeNoteFinish) els.modeNoteFinish.textContent = note;
}

function setGameMode(mode) {
  gameMode = mode;
  syncModeUi();
}

function startGame() {
  dismissIntro();
  game.targets = gameMode === "random" ? randomTargets() : gridTargetsForDate();
  game.round = 0;
  game.roundScores = [];
  game.roundResults = [];
  els.finishModal.setAttribute("hidden", "");
  els.scoreHistoryWrap.removeAttribute("hidden");
  renderScoreHistory();
  beginRound();
}

function beginRound() {
  game.phase = "draw";
  game.validatedThisRound = false;
  game.selectionIds = [];
  els.finishModal.setAttribute("hidden", "");
  ensureSketchLayersForDraw();
  clearSketch();
  paintZones();

  const target = game.targets[game.round];
  els.roundKicker.textContent = `Manche ${game.round + 1} / 5`;
  els.targetLabel.textContent = formatPop(target);
  els.roundResultSheet.setAttribute("hidden", "");
  els.resultSection.setAttribute("hidden", "");
  els.roundScoreBanner.setAttribute("hidden", "");
  renderScoreHistory();
  els.btnNext.setAttribute("hidden", "");
  els.btnPerfectZone.setAttribute("hidden", "");
  if ((map.getContainer()?.clientWidth || window.innerWidth) <= 520) {
    els.communes.checked = false;
    setCommunesVisible(false);
  }
  setDrawUi(false);
  startRoundTimer();
  scheduleRefit();
}

function finishRoundValidation() {
  if (game.phase !== "draw") return;
  const ring = game.sketchRing;
  if (!ring) return;
  stopRoundTimer();

  const ids = communesInRing(ring);
  const actual = populationForIds(ids);
  const target = game.targets[game.round];
  const pts = scoreForRound(target, actual);
  game.validatedThisRound = true;
  applyRoundResult({ pts, actual, ids, timedOut: false });
}

function applyRoundResult({ pts, actual, ids, timedOut }) {
  stopRoundTimer();
  const target = game.targets[game.round];
  const diff = actual - target;
  const diffPct = target ? (100 * diff) / target : 0;

  game.selectionIds = ids;
  game.roundScores.push(pts);
  game.roundResults.push({ target, actual, pts, count: ids.length, diff, diffPct, timedOut });
  paintZones();

  els.timerBlock.setAttribute("hidden", "");
  els.drawActions.setAttribute("hidden", "");
  renderScoreHistory();

  if (timedOut) {
    if (game.round >= 4) {
      showFinish();
    } else {
      game.round += 1;
      beginRound();
    }
    return;
  }

  game.phase = "result";

  els.roundScoreBanner.removeAttribute("hidden");
  els.roundResultSheet.removeAttribute("hidden");
  els.resultSection.removeAttribute("hidden");
  els.statsZoneLabel.textContent = "Dans votre zone";
  updateResultStatsDisplay(actual, ids, target);
  els.btnNext.removeAttribute("hidden");
  els.btnNext.textContent = game.round >= 4 ? "Voir le résultat final" : "Manche suivante";
  if (game.validatedThisRound) {
    els.btnPerfectZone.removeAttribute("hidden");
  } else {
    els.btnPerfectZone.setAttribute("hidden", "");
  }
  setSketchCursor(false);
}

function nextRound() {
  if (game.phase !== "result") return;
  if (game.round >= 4) {
    showFinish();
    return;
  }
  game.round += 1;
  beginRound();
}

function formatDiffLine(diff, timedOut) {
  if (timedOut) return "Temps écoulé";
  const sign = diff >= 0 ? "+" : "−";
  return `${sign}${fmt.format(Math.abs(diff))} habs.`;
}

function showFinish() {
  game.phase = "done";
  const total = game.roundScores.reduce((a, b) => a + b, 0);
  els.drawActions.setAttribute("hidden", "");
  els.btnNext.setAttribute("hidden", "");
  els.btnPerfectZone.setAttribute("hidden", "");
  els.roundResultSheet.setAttribute("hidden", "");
  els.resultSection.setAttribute("hidden", "");
  els.finalScore.textContent = `${total} / 100`;

  els.finishRecap.innerHTML = "";
  for (let i = 0; i < game.roundResults.length; i++) {
    const r = game.roundResults[i];
    const li = document.createElement("li");
    const title = document.createElement("p");
    title.className = "finish-recap-title";
    title.textContent = `Manche ${i + 1} — ${r.pts}/20`;
    const summary = document.createElement("p");
    summary.className = "finish-recap-detail";
    const obtained = r.timedOut ? "—" : formatPopShort(r.actual);
    summary.textContent = `Demandé ${formatPopTarget(r.target)} · Obtenu ${obtained}`;
    const diffLine = document.createElement("p");
    diffLine.className = "finish-recap-detail";
    diffLine.textContent = `Écart ${formatDiffLine(r.diff, r.timedOut)}`;
    li.append(title, summary, diffLine);
    els.finishRecap.appendChild(li);
  }

  syncModeUi();
  els.finishModal.removeAttribute("hidden");
  stopRoundTimer();
  scheduleRefit();
}

function clientToLngLat(clientX, clientY) {
  const rect = map.getCanvas().getBoundingClientRect();
  return map.unproject([clientX - rect.left, clientY - rect.top]).toArray();
}

function bindDrawing() {
  const canvas = map.getCanvas();
  let activePointerId = null;

  function appendStrokePoint(clientX, clientY) {
    const pt = clientToLngLat(clientX, clientY);
    game.stroke.push(pt);
    game.stroke = simplifyStroke(game.stroke, strokeSimplifyMovePx());
    updateSketchLayer();
  }

  function onPointerMove(event) {
    if (!game.drawing || game.phase !== "draw") return;
    if (activePointerId != null && event.pointerId !== activePointerId) return;
    event.preventDefault();
    appendStrokePoint(event.clientX, event.clientY);
  }

  function detachWindowStrokeListeners() {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", endStroke);
    window.removeEventListener("pointercancel", endStroke);
  }

  function endStroke(event) {
    if (!game.drawing) return;
    if (activePointerId != null && event.pointerId !== activePointerId) return;
    game.drawing = false;
    activePointerId = null;
    setSketchCursor(false);
    detachWindowStrokeListeners();
    try {
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    } catch (_) {
      /* capture déjà libéré (simulateur / certains navigateurs) */
    }
    game.stroke = simplifyStroke(game.stroke, strokeSimplifyEndPx());
    game.sketchRing = closedRingFromStroke(game.stroke);
    updateSketchLayer();
    setDrawUi(!!game.sketchRing);
  }

  canvas.addEventListener(
    "pointerdown",
    (event) => {
      if (game.phase !== "draw") return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      detachWindowStrokeListeners();
      game.drawing = true;
      activePointerId = event.pointerId;
      setSketchCursor(true);
      game.stroke = [clientToLngLat(event.clientX, event.clientY)];
      game.sketchRing = null;
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch (_) {
        /* ok sans capture si les listeners window suivent le tracé */
      }
      window.addEventListener("pointermove", onPointerMove, { passive: false });
      window.addEventListener("pointerup", endStroke);
      window.addEventListener("pointercancel", endStroke);
      updateSketchLayer();
      setDrawUi(false);
    },
    { passive: false }
  );
}

function mercUnit(lat) {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

let zonePaths = null;
const zoneCanvas = document.createElement("canvas");
const zoneCtx = zoneCanvas.getContext("2d", { alpha: true });
let zoneLive = false;

function eachRing(geometry, fn) {
  const coords = geometry.coordinates;
  if (geometry.type === "Polygon") {
    for (const ring of coords) fn(ring);
  } else if (geometry.type === "MultiPolygon") {
    for (const polygon of coords) for (const ring of polygon) fn(ring);
  }
}

function buildZonePaths() {
  const n = features.length;
  zonePaths = new Array(n);
  for (let i = 0; i < n; i++) {
    const geometry = features[i].geometry;
    const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    const path = new Path2D();
    for (const rings of polys) {
      for (const ring of rings) {
        if (ring.length < 3) continue;
        path.moveTo((ring[0][0] + 180) / 360, mercUnit(ring[0][1]));
        for (let k = 1; k < ring.length; k++) {
          path.lineTo((ring[k][0] + 180) / 360, mercUnit(ring[k][1]));
        }
        path.closePath();
      }
    }
    zonePaths[i] = path;
  }
}

function zoneCorners() {
  const w = map.transform.width;
  const h = map.transform.height;
  return [
    map.unproject([0, 0]).toArray(),
    map.unproject([w, 0]).toArray(),
    map.unproject([w, h]).toArray(),
    map.unproject([0, h]).toArray(),
  ];
}

function paintZones() {
  if (!zonePaths || !map.getSource("zone")) return;
  const cssW = map.transform.width;
  const cssH = map.transform.height;
  if (!cssW || !cssH) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pxW = Math.max(1, Math.round(cssW * dpr));
  const pxH = Math.max(1, Math.round(cssH * dpr));
  if (zoneCanvas.width !== pxW || zoneCanvas.height !== pxH) {
    zoneCanvas.width = pxW;
    zoneCanvas.height = pxH;
  }
  const world = map.transform.worldSize;
  const center = map.getCenter();
  const sx = ((center.lng + 180) / 360) * world;
  const sy = mercUnit(center.lat) * world;
  const ctx = zoneCtx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, pxW, pxH);
  ctx.setTransform(world * dpr, 0, 0, world * dpr, (-sx + cssW / 2) * dpr, (-sy + cssH / 2) * dpr);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = 1.25 / world;
  const ids = game.selectionIds;
  if (ids.length) {
    ctx.fillStyle = "#e8a19d";
    const combined = new Path2D();
    for (const i of ids) combined.addPath(zonePaths[i]);
    ctx.fill(combined, "evenodd");
  }
  const source = map.getSource("zone");
  source.setCoordinates(zoneCorners());
  source.play();
  if (!zoneLive) {
    zoneLive = true;
    map.once("render", () => {
      zoneLive = false;
      const live = map.getSource("zone");
      if (live) live.pause();
    });
  }
}

function paintMap(geojson, departements, france) {
  features = geojson.features;
  map.addSource("france", { type: "geojson", data: france });
  map.addLayer({
    id: "france-fill",
    type: "fill",
    source: "france",
    paint: { "fill-color": "#ffffff", "fill-opacity": 1, "fill-antialias": false },
  });
  map.addLayer({
    id: "france-line",
    type: "line",
    source: "france",
    paint: { "line-color": "#b8bcc4", "line-width": 1.2 },
  });
  map.addSource("communes", { type: "geojson", data: geojson });
  map.addLayer({
    id: "communes-line",
    type: "line",
    source: "communes",
    layout: {
      visibility: els.communes.checked ? "visible" : "none",
      "line-cap": "round",
      "line-join": "round",
    },
    paint: { "line-color": "#e2e5ea", "line-width": 0.35 },
  });
  buildZonePaths();
  zoneCanvas.width = Math.max(1, Math.round(map.transform.width || 2));
  zoneCanvas.height = Math.max(1, Math.round(map.transform.height || 2));
  map.addSource("zone", {
    type: "canvas",
    canvas: zoneCanvas,
    coordinates: zoneCorners(),
    animate: false,
  });
  map.addLayer({
    id: "zone",
    type: "raster",
    source: "zone",
    paint: { "raster-opacity": 1, "raster-fade-duration": 0 },
  });
  map.addSource("departements", { type: "geojson", data: departements });
  map.addLayer({
    id: "departements-line",
    type: "line",
    source: "departements",
    layout: {
      visibility: els.departments.checked ? "visible" : "none",
      "line-cap": "round",
      "line-join": "round",
    },
    paint: { "line-color": "#c4baaf", "line-width": 0.7 },
  });
  map.addSource("sketch", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({
    id: "sketch-line",
    type: "line",
    source: "sketch",
    filter: ["==", "$type", "LineString"],
    paint: { "line-color": "#c23b33", "line-width": 2.5 },
  });
  map.addLayer({
    id: "sketch-fill",
    type: "fill",
    source: "sketch",
    filter: ["==", "$type", "Polygon"],
    paint: { "fill-color": "#e8a19d", "fill-opacity": 0.55 },
  });
  map.addLayer({
    id: "sketch-outline",
    type: "line",
    source: "sketch",
    filter: ["==", "$type", "Polygon"],
    paint: { "line-color": "#c23b33", "line-width": 2 },
  });
  bindDrawing();
  placeCities();
}

function placeCities() {
  const byCode = new Map();
  for (let i = 0; i < index.codes.length; i++) byCode.set(index.codes[i], i);
  for (const code of CITY_CODES) {
    const i = byCode.get(code);
    if (i === undefined) continue;
    const el = document.createElement("div");
    el.className = MAJOR_CITY_CODES.has(code) ? "city-label major" : "city-label";
    const dot = document.createElement("i");
    const name = document.createElement("span");
    name.textContent = index.names[i];
    el.append(dot, name);
    const marker = new maplibregl.Marker({ element: el, anchor: "left" })
      .setLngLat(lonLatToMap(index.lon[i], index.lat[i]))
      .addTo(map);
    cityMarkers.push(marker);
  }
  setCitiesVisible(els.cities.checked);
}

function setCitiesVisible(on) {
  for (const marker of cityMarkers) marker.getElement().hidden = !on;
}

function setDepartmentsVisible(on) {
  if (!map.getLayer("departements-line")) return;
  map.setLayoutProperty("departements-line", "visibility", on ? "visible" : "none");
}

function setCommunesVisible(on) {
  if (!map.getLayer("communes-line")) return;
  map.setLayoutProperty("communes-line", "visibility", on ? "visible" : "none");
}

els.modeRandom.addEventListener("click", () => setGameMode("random"));
els.modeGrid.addEventListener("click", () => setGameMode("grid"));
els.modeRandomFinish.addEventListener("click", () => setGameMode("random"));
els.modeGridFinish.addEventListener("click", () => setGameMode("grid"));

els.btnStart.addEventListener("click", () => startGame());
els.btnClear.addEventListener("click", () => {
  clearSketch();
  setDrawUi(false);
});
els.btnValidate.addEventListener("click", () => finishRoundValidation());
els.btnNext.addEventListener("click", () => nextRound());
els.btnPerfectZone.addEventListener("click", () => showPerfectZonePreview());
els.btnReplay.addEventListener("click", () => {
  stopRoundTimer();
  game.phase = "idle";
  game.selectionIds = [];
  clearSketch();
  paintZones();
  els.timerBlock.setAttribute("hidden", "");
  els.finishModal.setAttribute("hidden", "");
  startGame();
});

els.cities.addEventListener("change", () => setCitiesVisible(els.cities.checked));
els.departments.addEventListener("change", () => setDepartmentsVisible(els.departments.checked));
els.communes.addEventListener("change", () => setCommunesVisible(els.communes.checked));

map.on("move", () => {
  paintZones();
  updateSketchLayer();
  positionDrawActions();
});

window.addEventListener("resize", () => positionDrawActions());

syncModeUi();

map.on("load", async () => {
  const loadParts = { index: 0, dep: 0, france: 0, communes: 0 };
  const loadWeights = { index: 0.06, dep: 0.08, france: 0.08, communes: 0.78 };
  const loadBase = 12;
  const loadSpan = 83;

  function refreshLoadProgress() {
    let sum = 0;
    for (const key of Object.keys(loadWeights)) sum += loadWeights[key] * loadParts[key];
    loader.set(loadBase + sum * loadSpan);
  }

  loader.set(10);

  try {
    const [indexData, geojson, departements, france] = await Promise.all([
      fetchJsonWithProgress("data/index.json", (r) => {
        loadParts.index = r;
        refreshLoadProgress();
      }),
      fetchJsonWithProgress("data/communes.geojson?v=l93", (r) => {
        loadParts.communes = r;
        refreshLoadProgress();
      }),
      fetchJsonWithProgress("data/departements.geojson?v=ne10m", (r) => {
        loadParts.dep = r;
        refreshLoadProgress();
      }),
      fetchJsonWithProgress("data/france.geojson?v=silhouette", (r) => {
        loadParts.france = r;
        refreshLoadProgress();
      }),
    ]);
    index = indexData;
    loader.set(96);
    paintMap(geojson, departements, france);
    setIntroMapView();
    frameFrance(true);
    loader.set(100);
    loader.hide();
    els.status.textContent = "";
  } catch (error) {
    els.loadOverlay.hidden = true;
    els.status.textContent = `Impossible de charger les données (${error.message}).`;
  }
});
