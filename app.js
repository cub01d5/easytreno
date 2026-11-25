/**
 * EasyTreno — App Logic
 * Mobile-first Italian train board defaulting to Vigevano (Trenord & Trenitalia via Transitous).
 */

const TRANSITOUS_BASE = 'https://api.transitous.org/api/v1';
const LIVE_FEED_URL = 'https://raw.githubusercontent.com/cub01d5/easytreno/live-data/live.json';

const RAIL_MODES = new Set([
  'RAIL',
  'REGIONAL_RAIL',
  'HIGHSPEED_RAIL',
  'LONG_DISTANCE',
  'SUBURBAN',
  'NIGHT_RAIL',
]);

const DEFAULT_STATIONS = [
  { id: 'it-Lombardia-Trenord_S01061', name: 'Vigevano', vtCode: 'S01061', rfiId: '3053' },
  { id: 'it-Lombardia-Trenord_S01630', name: 'Milano S. Cristoforo', vtCode: 'S01630', rfiId: '1721' },
  { id: 'it-Lombardia-Trenord_S01632', name: 'Milano Scalo Romana', vtCode: 'S01632', rfiId: '1717' },
  { id: 'it-Lombardia-Trenord_S01059', name: 'Albairate-Vermezzo', vtCode: 'S01059', rfiId: '779' },
];

const STORAGE_KEYS = {
  PINNED: 'easytreno_pinned_v2',
  HOME: 'easytreno_home_v1',
  THEME: 'easytreno_theme_v1',
};

const ROUTE_PRESETS = {
  'vig-cri': [DEFAULT_STATIONS[0], DEFAULT_STATIONS[1]],
  'cri-vig': [DEFAULT_STATIONS[1], DEFAULT_STATIONS[0]],
  'vig-rom': [DEFAULT_STATIONS[0], DEFAULT_STATIONS[2]],
  'vig-alb': [DEFAULT_STATIONS[0], DEFAULT_STATIONS[3]],
};

// Application State
const state = {
  view: 'board', // 'board' | 'route'
  pinnedStations: loadPinnedStations(),
  homeStationId: localStorage.getItem(STORAGE_KEYS.HOME) || DEFAULT_STATIONS[0].id,
  activeStation: null,
  boardMode: 'departures', // 'departures' | 'arrivals'
  timePreset: 'now', // 'now' | '+1h' | '+2h' | 'evening' | 'tomorrow' | 'custom' | 'cursor'
  targetDate: new Date(),
  activeDirection: 'ALL',
  rawTrains: [],
  liveMap: new Map(), // trainNumber -> { delay, track, isActualTrack, cancelled }
  liveTrains: {}, // trainNumber -> { r, lu, lo, np, c, f: { vtStopCode: { t, d, st } } }
  liveUpdatedTime: null,
  nextCursor: null,
  prevCursor: null,
  isLoading: false,
  boardAbort: null,
  searchAbort: null,
  routeAbort: null,
  tripCache: new Map(),
  stationPickerTarget: 'board', // 'board' | 'route-from' | 'route-to'
  routeFrom: DEFAULT_STATIONS[0],
  routeTo: DEFAULT_STATIONS[1],
};

// DOM References
const $ = (id) => document.getElementById(id);

const els = {
  activeStationName: $('active-station-name'),
  stationHeaderBtn: $('station-header-btn'),
  liveRfiLink: $('live-rfi-link'),
  themeToggleBtn: $('theme-toggle-btn'),
  themeIconSun: $('theme-icon-sun'),
  themeIconMoon: $('theme-icon-moon'),
  pinnedStrip: $('pinned-stations-strip'),

  tabBoard: $('tab-board'),
  tabRoute: $('tab-route'),
  boardView: $('board-view'),
  routeView: $('route-view'),

  modeDepartures: $('mode-departures'),
  modeArrivals: $('mode-arrivals'),
  lastUpdatedLabel: $('last-updated-label'),
  refreshBtn: $('refresh-btn'),
  timePresetsRow: $('time-presets-row'),
  customTimeBox: $('custom-time-box'),
  boardDatetimeInput: $('board-datetime-input'),
  applyCustomTimeBtn: $('apply-custom-time-btn'),
  directionFilterRow: $('direction-filter-row'),
  boardSummaryText: $('board-summary-text'),
  proxyStatusBadge: $('proxy-status-badge'),
  trainsList: $('trains-list'),
  paginationBar: $('pagination-bar'),
  pageEarlierBtn: $('page-earlier-btn'),
  pageNowBtn: $('page-now-btn'),
  pageLaterBtn: $('page-later-btn'),

  routeFromBtn: $('route-from-btn'),
  routeToBtn: $('route-to-btn'),
  routeFromLabel: $('route-from-label'),
  routeToLabel: $('route-to-label'),
  routeSwapBtn: $('route-swap-btn'),
  routeDatetimeInput: $('route-datetime-input'),
  routeSearchBtn: $('route-search-btn'),
  routeResultsList: $('route-results-list'),

  trainSheet: $('train-sheet-backdrop'),
  trainSheetTitle: $('train-sheet-title'),
  trainSheetSubtitle: $('train-sheet-subtitle'),
  trainSheetBody: $('train-sheet-body'),

  stationSheet: $('station-sheet-backdrop'),
  stationSheetTitle: $('station-sheet-title'),
  stationSearchInput: $('station-search-input'),
  stationSearchClear: $('station-search-clear'),
  stationSearchResults: $('station-search-results'),
  pinnedManageSection: $('pinned-manage-section'),
  pinnedManageList: $('pinned-manage-list'),
};

// ============================================================================
// Utilities & Formatting (Italy Europe/Rome timezone)
// ============================================================================

const fmtTimeRome = new Intl.DateTimeFormat('it-IT', {
  timeZone: 'Europe/Rome',
  hour: '2-digit',
  minute: '2-digit',
});

const fmtDayRome = new Intl.DateTimeFormat('it-IT', {
  timeZone: 'Europe/Rome',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTime(isoOrDate) {
  if (!isoOrDate) return '--:--';
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return '--:--';
  return fmtTimeRome.format(d);
}

function getRomeParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  if (map.hour === '24') map.hour = '00';
  return map;
}

function toDatetimeLocalValue(date = new Date()) {
  const p = getRomeParts(date);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/**
 * Parse a YYYY-MM-DDTHH:mm string as Europe/Rome local wall-clock time.
 */
function parseRomeDatetimeLocal(value) {
  if (!value) return new Date();
  const [datePart, timePart] = value.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = (timePart || '00:00').split(':').map(Number);
  // Estimate UTC and correct using actual Europe/Rome offset at that instant
  const guessUtc = new Date(Date.UTC(y, m - 1, d, hh, mm, 0));
  const romeAtGuess = getRomeParts(guessUtc);
  const guessAsRomeUtc = Date.UTC(
    Number(romeAtGuess.year),
    Number(romeAtGuess.month) - 1,
    Number(romeAtGuess.day),
    Number(romeAtGuess.hour),
    Number(romeAtGuess.minute),
    0
  );
  const offsetMs = guessAsRomeUtc - guessUtc.getTime();
  return new Date(Date.UTC(y, m - 1, d, hh, mm, 0) - offsetMs);
}

function isSameRomeDay(d1, d2) {
  const a = getRomeParts(d1);
  const b = getRomeParts(d2);
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

function formatCountdown(isoTime) {
  if (!isoTime) return { label: '', soon: false };
  const diffMin = Math.round((new Date(isoTime).getTime() - Date.now()) / 60000);
  if (diffMin < -1) return { label: 'passato', soon: false };
  if (diffMin <= 1) return { label: 'in arrivo', soon: true };
  if (diffMin < 60) return { label: `tra ${diffMin} min`, soon: diffMin <= 15 };
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  return { label: m > 0 ? `tra ${h}h ${m}m` : `tra ${h}h`, soon: false };
}

function formatDuration(seconds) {
  const totalMin = Math.round(seconds / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function deriveVtCode(stopId) {
  if (!stopId) return null;
  const trenordMatch = stopId.match(/_(S\d{5})$/);
  if (trenordMatch) return trenordMatch[1];
  const tiMatch = stopId.match(/trenitalia_(\d{5})/);
  if (tiMatch) return `S${tiMatch[1]}`;
  return null;
}

function getLiveRfiUrl(station, isArrivals) {
  if (station?.rfiId) {
    return `https://iechub.rfi.it/ArriviPartenze/ArrivalsDepartures/Monitor?placeId=${encodeURIComponent(station.rfiId)}&arrivals=${isArrivals ? 'True' : 'False'}`;
  }
  return 'https://iechub.rfi.it/ArriviPartenze/ArrivalsDepartures/Home';
}

function extractTrainMeta(st) {
  const display = (st.displayName || st.routeShortName || '').trim();
  const short = (st.tripShortName || '').trim();
  let line = display;
  let number = '';

  // Trenord format: tripShortName = "R31 - 10054", displayName = "R31"
  const dashMatch = short.match(/^([A-Z0-9]+)\s*-\s*(\d+)$/i);
  if (dashMatch) {
    line = line || dashMatch[1];
    number = dashMatch[2];
  } else {
    const numMatch = (short || display).match(/(\d{2,6})/);
    if (numMatch) number = numMatch[1];
  }

  // Category styling
  let badgeClass = 'reg';
  const mode = st.mode || '';
  const upper = `${line} ${short}`.toUpperCase();
  if (mode === 'HIGHSPEED_RAIL' || /^(FR|FA|FB|AV|ITA)/.test(upper)) {
    badgeClass = 'hs';
  } else if (mode === 'LONG_DISTANCE' || mode === 'NIGHT_RAIL' || /^(IC|ICN|EC|EN)/.test(upper)) {
    badgeClass = 'ic';
  } else if (mode === 'SUBURBAN' || /^S\d+/.test(upper)) {
    badgeClass = 'sub';
  }

  const agencyRaw = (st.agencyName || '').trim();
  let agency = agencyRaw;
  if (/trenitalia/i.test(agencyRaw)) agency = 'Trenitalia';
  else if (/trenord/i.test(agencyRaw)) agency = 'Trenord';
  else if (/italo|ntv/i.test(agencyRaw)) agency = 'Italo';

  return {
    line: line || 'REG',
    number,
    badgeClass,
    agency,
  };
}

function cleanStationDisplayName(name) {
  if (!name) return '';
  // Convert ALL CAPS station names from Trenitalia feeds into readable Title Case
  if (name === name.toUpperCase() && name.length > 3) {
    return name
      .toLowerCase()
      .replace(/(^|[\s\-.'/])([a-zàèéìòù])/g, (_, sep, ch) => sep + ch.toUpperCase());
  }
  return name;
}

// ============================================================================
// Persistence & Theme
// ============================================================================

function loadPinnedStations() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.PINNED);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Hydrate known RFI IDs if missing
        return parsed.map((s) => {
          const def = DEFAULT_STATIONS.find((d) => d.id === s.id);
          return {
            id: s.id,
            name: s.name,
            vtCode: s.vtCode || def?.vtCode || deriveVtCode(s.id),
            rfiId: s.rfiId || def?.rfiId || null,
          };
        });
      }
    }
  } catch {
    // Fallback to defaults
  }
  return DEFAULT_STATIONS.map((s) => ({ ...s }));
}

function savePinnedStations() {
  localStorage.setItem(STORAGE_KEYS.PINNED, JSON.stringify(state.pinnedStations));
}

function initTheme() {
  const saved = localStorage.getItem(STORAGE_KEYS.THEME);
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  applyTheme(theme, false);
}

function applyTheme(theme, persist = true) {
  document.documentElement.setAttribute('data-theme', theme);
  els.themeIconSun.classList.toggle('hidden', theme !== 'dark');
  els.themeIconMoon.classList.toggle('hidden', theme === 'dark');
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute('content', theme === 'dark' ? '#0e1411' : '#0A6C3D');
  if (persist) localStorage.setItem(STORAGE_KEYS.THEME, theme);
}

// ============================================================================
// Transitous & Optional Viaggiatreno API
// ============================================================================

async function fetchJson(url, signal) {
  const res = await fetch(url, {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

async function searchItalianRailStations(query, signal) {
  const url = `${TRANSITOUS_BASE}/geocode?text=${encodeURIComponent(query)}&type=STOP&language=it`;
  const list = await fetchJson(url, signal);
  if (!Array.isArray(list)) return [];

  const filtered = list.filter((item) => {
    if (item.country && item.country !== 'IT') return false;
    const modes = Array.isArray(item.modes) ? item.modes : [];
    return modes.some((m) => RAIL_MODES.has(m));
  });

  // Deduplicate by normalized name, preferring official Trenord / Trenitalia IDs
  const byName = new Map();
  for (const item of filtered) {
    const cleanName = cleanStationDisplayName(item.name);
    const key = cleanName.toLowerCase();
    const isPrimary =
      item.id.startsWith('it-Lombardia-Trenord_') || item.id.startsWith('it-trenitalia_');
    const existing = byName.get(key);
    if (!existing || (isPrimary && !existing._primary)) {
      const def = DEFAULT_STATIONS.find((d) => d.id === item.id);
      const area =
        item.areas?.find((a) => a.adminLevel === 6)?.name ||
        item.areas?.find((a) => a.adminLevel === 4)?.name ||
        '';
      byName.set(key, {
        id: item.id,
        name: cleanName,
        area,
        vtCode: def?.vtCode || deriveVtCode(item.id),
        rfiId: def?.rfiId || null,
        modes: item.modes || [],
        _primary: isPrimary,
      });
    }
  }
  return Array.from(byName.values()).slice(0, 12);
}

async function fetchViaggiatrenoLive(station, boardMode, signal) {
  const empty = { map: new Map(), updatedTime: null };
  if (!station?.vtCode) return empty;

  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => timeoutCtrl.abort(), 5000);
  const onParentAbort = () => timeoutCtrl.abort();
  signal?.addEventListener('abort', onParentAbort, { once: true });

  try {
    const feed = await fetchJson(`${LIVE_FEED_URL}?t=${Math.floor(Date.now() / 60000)}`, timeoutCtrl.signal);
    if (!feed?.updatedAt || !feed?.stations?.[station.vtCode]) return empty;

    // Ignore stale snapshots older than 45 minutes
    const ageMin = (Date.now() - new Date(feed.updatedAt).getTime()) / 60000;
    if (ageMin > 45) return empty;

    state.liveTrains = feed.trains && typeof feed.trains === 'object' ? feed.trains : {};

    const bucket = feed.stations[station.vtCode][boardMode === 'arrivals' ? 'arrivi' : 'partenze'] || {};
    const map = new Map();
    for (const [num, entry] of Object.entries(bucket)) {
      map.set(num, {
        delay: typeof entry.d === 'number' ? entry.d : null,
        track: entry.b ? String(entry.b).trim() : null,
        isActualTrack: Boolean(entry.be),
        cancelled: Boolean(entry.c),
      });
    }
    return { map, updatedTime: feed.romeTime || formatTime(feed.updatedAt) };
  } catch {
    return empty;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onParentAbort);
  }
}

// ============================================================================
// Board Loading & Rendering
// ============================================================================

function computeTargetDateFromPreset(preset) {
  const now = new Date();
  if (preset === 'now') return now;
  if (preset === '+1h') return new Date(now.getTime() + 60 * 60 * 1000);
  if (preset === '+2h') return new Date(now.getTime() + 2 * 60 * 60 * 1000);
  if (preset === 'evening') {
    const p = getRomeParts(now);
    return parseRomeDatetimeLocal(`${p.year}-${p.month}-${p.day}T18:00`);
  }
  if (preset === 'tomorrow') {
    const tmr = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const p = getRomeParts(tmr);
    return parseRomeDatetimeLocal(`${p.year}-${p.month}-${p.day}T07:00`);
  }
  return state.targetDate;
}

function renderPinnedStrip() {
  const frag = document.createDocumentFragment();
  for (const st of state.pinnedStations) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `station-chip${state.activeStation?.id === st.id ? ' active' : ''}`;
    btn.dataset.stationId = st.id;
    btn.innerHTML =
      st.id === state.homeStationId
        ? `<span class="chip-home-dot" aria-hidden="true"></span><span>${escapeHtml(st.name)}</span>`
        : `<span>${escapeHtml(st.name)}</span>`;
    btn.addEventListener('click', () => selectActiveStation(st));
    frag.appendChild(btn);
  }

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.id = 'add-station-chip';
  addBtn.className = 'station-chip station-chip-add';
  addBtn.textContent = '+ Stazione';
  addBtn.addEventListener('click', () => openStationSheet('board'));
  frag.appendChild(addBtn);

  els.pinnedStrip.innerHTML = '';
  els.pinnedStrip.appendChild(frag);
}

function updateHeaderUI() {
  const st = state.activeStation;
  if (!st) return;
  els.activeStationName.textContent = st.name;
  els.liveRfiLink.href = getLiveRfiUrl(st, state.boardMode === 'arrivals');
  document.title = `${st.name} · EasyTreno`;

  // Keep URL shareable
  try {
    const u = new URL(window.location.href);
    u.searchParams.set('station', st.id);
    u.searchParams.set('name', st.name);
    window.history.replaceState(null, '', u.toString());
  } catch {
    // ignore in restricted contexts
  }
}

function renderSkeletons(container, count = 5) {
  container.innerHTML = Array.from({ length: count })
    .map(() => '<div class="skeleton-card" aria-hidden="true"></div>')
    .join('');
}

async function loadBoard({ cursor = null } = {}) {
  if (!state.activeStation) return;

  if (state.boardAbort) state.boardAbort.abort();
  const controller = new AbortController();
  state.boardAbort = controller;

  state.isLoading = true;
  els.refreshBtn.classList.add('spinning');
  if (!cursor) {
    state.targetDate = computeTargetDateFromPreset(state.timePreset);
  }

  renderSkeletons(els.trainsList, 6);
  els.paginationBar.classList.add('hidden');
  updateBoardSummary();

  const stopId = state.activeStation.id;
  const isArrivals = state.boardMode === 'arrivals';

  let url;
  if (cursor) {
    url = `${TRANSITOUS_BASE}/stoptimes?stopId=${encodeURIComponent(stopId)}&mode=RAIL&n=18&pageCursor=${encodeURIComponent(cursor)}`;
  } else if (isArrivals) {
    // MOTIS arriveBy=true walks backwards from `time`, so query +3h ahead and filter forward
    const windowEnd = new Date(state.targetDate.getTime() + 3 * 60 * 60 * 1000);
    url = `${TRANSITOUS_BASE}/stoptimes?stopId=${encodeURIComponent(stopId)}&mode=RAIL&n=24&arriveBy=true&time=${encodeURIComponent(windowEnd.toISOString())}`;
  } else {
    url = `${TRANSITOUS_BASE}/stoptimes?stopId=${encodeURIComponent(stopId)}&mode=RAIL&n=18&time=${encodeURIComponent(state.targetDate.toISOString())}`;
  }

  const shouldFetchLive = isSameRomeDay(state.targetDate, new Date()) && !cursor;

  try {
    const [data, liveResult] = await Promise.all([
      fetchJson(url, controller.signal),
      shouldFetchLive
        ? fetchViaggiatrenoLive(state.activeStation, state.boardMode, controller.signal)
        : Promise.resolve({ map: new Map(), updatedTime: null }),
    ]);

    if (controller.signal.aborted) return;

    let items = Array.isArray(data.stopTimes) ? data.stopTimes : [];

    // Filter & sort cleanly
    if (isArrivals && !cursor) {
      const minTs = state.targetDate.getTime() - 5 * 60 * 1000;
      items = items
        .filter((st) => st.place?.arrival && new Date(st.place.arrival).getTime() >= minTs)
        .sort((a, b) => new Date(a.place.arrival) - new Date(b.place.arrival));
    } else if (!isArrivals) {
      items = items
        .filter((st) => st.place?.departure)
        .sort((a, b) => new Date(a.place.departure) - new Date(b.place.departure));
    } else {
      items = items
        .filter((st) => st.place?.arrival)
        .sort((a, b) => new Date(a.place.arrival) - new Date(b.place.arrival));
    }

    state.rawTrains = items;
    state.liveMap = liveResult.map;
    state.liveUpdatedTime = liveResult.updatedTime;
    state.nextCursor = data.nextPageCursor || null;
    state.prevCursor = data.previousPageCursor || null;

    if (liveResult.map.size > 0) {
      els.proxyStatusBadge.textContent = liveResult.updatedTime
        ? `Live ${liveResult.updatedTime}`
        : 'Live';
      els.proxyStatusBadge.classList.remove('hidden');
    } else {
      els.proxyStatusBadge.classList.add('hidden');
    }
    els.lastUpdatedLabel.textContent = formatTime(new Date());

    renderDirectionFilters();
    renderTrainsList();
  } catch (err) {
    if (err.name === 'AbortError') return;
    els.trainsList.innerHTML = `
      <div class="state-card">
        <h3 class="state-title">Impossibile caricare gli orari</h3>
        <p class="state-desc">Controlla la connessione internet o riprova tra qualche secondo. Puoi comunque aprire il tabellone live RFI in alto.</p>
        <button type="button" id="retry-board-btn" class="primary-btn">Riprova</button>
      </div>
    `;
    $('retry-board-btn')?.addEventListener('click', () => loadBoard({ cursor }));
  } finally {
    if (state.boardAbort === controller) {
      state.isLoading = false;
      els.refreshBtn.classList.remove('spinning');
    }
  }
}

function updateBoardSummary() {
  const modeLabel = state.boardMode === 'arrivals' ? 'Arrivi' : 'Partenze';
  const now = new Date();
  let whenLabel;
  if (state.timePreset === 'now') {
    whenLabel = 'adesso';
  } else if (isSameRomeDay(state.targetDate, now)) {
    whenLabel = `oggi dalle ${formatTime(state.targetDate)}`;
  } else {
    whenLabel = `${fmtDayRome.format(state.targetDate)} · ${formatTime(state.targetDate)}`;
  }
  els.boardSummaryText.textContent = `${modeLabel} · ${whenLabel}`;
}

function renderDirectionFilters() {
  const counts = new Map();
  for (const st of state.rawTrains) {
    const dest = cleanStationDisplayName(st.headsign || '');
    if (!dest) continue;
    counts.set(dest, (counts.get(dest) || 0) + 1);
  }

  const topDirs = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name]) => name);

  if (topDirs.length <= 1) {
    state.activeDirection = 'ALL';
    els.directionFilterRow.classList.add('hidden');
    return;
  }

  if (state.activeDirection !== 'ALL' && !topDirs.includes(state.activeDirection)) {
    state.activeDirection = 'ALL';
  }

  const frag = document.createDocumentFragment();
  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = `dir-pill${state.activeDirection === 'ALL' ? ' active' : ''}`;
  allBtn.textContent = 'Tutte';
  allBtn.addEventListener('click', () => {
    state.activeDirection = 'ALL';
    renderDirectionFilters();
    renderTrainsList();
  });
  frag.appendChild(allBtn);

  for (const dir of topDirs) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `dir-pill${state.activeDirection === dir ? ' active' : ''}`;
    btn.textContent = state.boardMode === 'arrivals' ? `dir. ${dir}` : `→ ${dir}`;
    btn.addEventListener('click', () => {
      state.activeDirection = dir;
      renderDirectionFilters();
      renderTrainsList();
    });
    frag.appendChild(btn);
  }

  els.directionFilterRow.innerHTML = '';
  els.directionFilterRow.appendChild(frag);
  els.directionFilterRow.classList.remove('hidden');
}

function renderTrainsList() {
  const isArrivals = state.boardMode === 'arrivals';
  const filtered =
    state.activeDirection === 'ALL'
      ? state.rawTrains
      : state.rawTrains.filter(
          (st) => cleanStationDisplayName(st.headsign || '') === state.activeDirection
        );

  if (filtered.length === 0) {
    els.trainsList.innerHTML = `
      <div class="state-card">
        <h3 class="state-title">Nessun treno in questa fascia</h3>
        <p class="state-desc">Non ci sono ${isArrivals ? 'arrivi' : 'partenze'} programmati per questa ricerca. Prova la fascia successiva o un'altra ora.</p>
        <button type="button" id="empty-later-btn" class="secondary-btn">Cerca treni più tardi</button>
      </div>
    `;
    $('empty-later-btn')?.addEventListener('click', () => {
      if (state.nextCursor) {
        state.timePreset = 'cursor';
        updateTimePresetPills();
        loadBoard({ cursor: state.nextCursor });
      } else {
        state.targetDate = new Date(state.targetDate.getTime() + 2 * 60 * 60 * 1000);
        state.timePreset = 'custom';
        updateTimePresetPills();
        loadBoard();
      }
    });
    els.paginationBar.classList.remove('hidden');
    updatePaginationButtons();
    return;
  }

  const showCountdown = isSameRomeDay(state.targetDate, new Date());

  const html = filtered
    .map((st, idx) => {
      const meta = extractTrainMeta(st);
      const primaryIso = isArrivals ? st.place.arrival : st.place.departure;
      const dest = cleanStationDisplayName(st.headsign || 'Destinazione');

      // Live info from live-data snapshot, custom proxy, or Transitous GTFS-RT
      const live = meta.number ? state.liveMap.get(meta.number) : null;
      let delayMin = live?.delay ?? null;
      if (delayMin === null && st.realTime) {
        const schedIso = isArrivals ? st.place.scheduledArrival : st.place.scheduledDeparture;
        if (schedIso && primaryIso) {
          delayMin = Math.round((new Date(primaryIso) - new Date(schedIso)) / 60000);
        }
      }

      const track = live?.track || st.place?.track || st.place?.scheduledTrack || null;
      const isCancelled = Boolean(live?.cancelled || st.cancelled);

      // 4 clear color states:
      // - Black: Cancellato
      // - Green: In orario (<= 0 min)
      // - Amber/Yellow: Ritardo lieve (1..10 min)
      // - Red: Ritardo > 10 min
      let statusClass = '';
      let statusPillHtml = '';
      if (isCancelled) {
        statusClass = ' state-cancelled';
        statusPillHtml = '<span class="train-delay-pill cancelled">Cancellato</span>';
      } else if (delayMin !== null) {
        if (delayMin <= 0) {
          statusClass = ' state-ontime';
          statusPillHtml = '<span class="train-delay-pill ontime">In orario</span>';
        } else if (delayMin <= 10) {
          statusClass = ' state-minor';
          statusPillHtml = `<span class="train-delay-pill minor">+${delayMin} min</span>`;
        } else {
          statusClass = ' state-major';
          statusPillHtml = `<span class="train-delay-pill major">+${delayMin} min</span>`;
        }
      }

      const cd = showCountdown ? formatCountdown(primaryIso) : { label: '', soon: false };

      const trackBoxHtml = track
        ? `<div class="track-box${live?.isActualTrack ? ' live-track' : ''}" aria-label="Binario ${escapeHtml(track)}">
             <span class="track-box-label">BIN</span>
             <span class="track-box-num">${escapeHtml(track)}</span>
           </div>`
        : `<div class="track-box empty-track" aria-label="Binario non disponibile">
             <span class="track-box-label">BIN</span>
             <span class="track-box-num">—</span>
           </div>`;

      return `
        <button type="button" class="train-card${statusClass}" data-train-index="${idx}">
          <div class="train-time-col">
            <span class="train-time">${escapeHtml(formatTime(primaryIso))}</span>
            ${statusPillHtml || (cd.label ? `<span class="train-countdown${cd.soon ? ' soon' : ''}">${escapeHtml(cd.label)}</span>` : '')}
          </div>

          <div class="train-main-col">
            <div class="train-dest-row">
              <span class="train-dir-arrow" aria-hidden="true">${isArrivals ? '↘' : '→'}</span>
              <span class="train-destination">${escapeHtml(dest)}</span>
            </div>
            <div class="train-sub-row">
              <span class="line-badge ${meta.badgeClass}">${escapeHtml(meta.line)}</span>
              ${meta.number && !meta.line.includes(meta.number) ? `<span class="train-number">${escapeHtml(meta.number)}</span>` : ''}
              ${statusPillHtml && cd.label && !isCancelled ? `<span class="train-countdown${cd.soon ? ' soon' : ''}">· ${escapeHtml(cd.label)}</span>` : ''}
            </div>
          </div>

          <div class="train-right-col">
            ${trackBoxHtml}
            <svg class="row-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </div>
        </button>
      `;
    })
    .join('');

  els.trainsList.innerHTML = html;

  // Bind tap -> train details sheet
  els.trainsList.querySelectorAll('.train-card').forEach((card) => {
    card.addEventListener('click', () => {
      const idx = Number(card.dataset.trainIndex);
      const train = filtered[idx];
      if (train) openTrainDetailSheet(train);
    });
  });

  els.paginationBar.classList.remove('hidden');
  updatePaginationButtons();
}

function updatePaginationButtons() {
  els.pageEarlierBtn.disabled = !state.prevCursor && state.boardMode !== 'arrivals';
  els.pageLaterBtn.disabled = !state.nextCursor && state.boardMode !== 'arrivals';
}

// ============================================================================
// Train Detail Bottom Sheet (All Stops Timeline)
// ============================================================================

function buildDelayPillHtml(delayMin, cancelled = false, cancelledLabel = 'Cancellato') {
  if (cancelled) {
    return `<span class="train-delay-pill cancelled">${escapeHtml(cancelledLabel)}</span>`;
  }
  if (typeof delayMin !== 'number') return '';
  if (delayMin <= 0) {
    return '<span class="train-delay-pill ontime">In orario</span>';
  }
  if (delayMin <= 10) {
    return `<span class="train-delay-pill minor">+${delayMin} min</span>`;
  }
  return `<span class="train-delay-pill major">+${delayMin} min</span>`;
}

function addMinutesToIso(iso, deltaMin) {
  if (!iso || typeof deltaMin !== 'number') return null;
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  return formatTime(new Date(ms + deltaMin * 60000));
}

async function openTrainDetailSheet(trainItem) {
  const meta = extractTrainMeta(trainItem);
  const dest = cleanStationDisplayName(trainItem.headsign || '');
  const titleNum =
    meta.number && !meta.line.includes(meta.number) ? `${meta.line} · ${meta.number}` : meta.line;

  els.trainSheetTitle.textContent = titleNum;
  els.trainSheetSubtitle.textContent = `${dest}${meta.agency ? ` · ${meta.agency}` : ''}`;
  els.trainSheetBody.innerHTML = `
    <div class="skeleton-card" style="height: 52px;"></div>
    <div class="skeleton-card" style="height: 52px;"></div>
    <div class="skeleton-card" style="height: 52px;"></div>
    <div class="skeleton-card" style="height: 52px;"></div>
  `;

  openSheet('train-sheet-backdrop');

  const tripId = trainItem.tripId;
  if (!tripId) {
    els.trainSheetBody.innerHTML = `<p class="settings-hint">Dettaglio fermate non disponibile per questo treno.</p>`;
    return;
  }

  try {
    let tripData = state.tripCache.get(tripId);
    if (!tripData) {
      tripData = await fetchJson(`${TRANSITOUS_BASE}/trip?tripId=${encodeURIComponent(tripId)}`);
      state.tripCache.set(tripId, tripData);
    }

    const leg = tripData?.legs?.[0];
    if (!leg) throw new Error('Dati corsa vuoti');

    const stops = [
      { ...leg.from, _kind: 'origin' },
      ...(leg.intermediateStops || []).map((s) => ({ ...s, _kind: 'mid' })),
      { ...leg.to, _kind: 'dest' },
    ];

    const activeNameNorm = (state.activeStation?.name || '').toLowerCase();
    const activeIdx = stops.findIndex(
      (s) =>
        s.stopId === state.activeStation?.id ||
        cleanStationDisplayName(s.name).toLowerCase() === activeNameNorm
    );

    const originName = cleanStationDisplayName(leg.from.name);
    const destName = cleanStationDisplayName(leg.to.name);
    els.trainSheetSubtitle.textContent = `${originName} → ${destName} · ${stops.length} fermate`;

    // Look up live Viaggiatreno stop-by-stop info for today's trains
    const isToday = isSameRomeDay(state.targetDate, new Date());
    const liveTrain = isToday && meta.number ? state.liveTrains?.[meta.number] || null : null;
    const liveStops = liveTrain?.f || null;

    let bannerHtml = '';
    if (liveTrain) {
      if (liveTrain.c) {
        bannerHtml = `
          <div class="train-live-banner">
            <span>Treno <strong>cancellato</strong></span>
            ${buildDelayPillHtml(null, true, 'Cancellato')}
          </div>
        `;
      } else if (liveTrain.lu) {
        const lastSt = cleanStationDisplayName(liveTrain.lu);
        const lastAt = liveTrain.lo ? ` alle <strong>${escapeHtml(liveTrain.lo)}</strong>` : '';
        bannerHtml = `
          <div class="train-live-banner">
            <span>Ultimo passaggio: <strong>${escapeHtml(lastSt)}</strong>${lastAt}</span>
            ${buildDelayPillHtml(liveTrain.r, false)}
          </div>
        `;
      } else if (liveTrain.np) {
        bannerHtml = `
          <div class="train-live-banner">
            <span>Stato: <strong>Non ancora partito</strong></span>
            ${buildDelayPillHtml(liveTrain.r, false)}
          </div>
        `;
      }
    }

    const timelineHtml = stops
      .map((s, i) => {
        const stopName = cleanStationDisplayName(s.name);
        const arr = s.scheduledArrival || s.arrival;
        const dep = s.scheduledDeparture || s.departure;
        const schedIso = dep || arr;
        const mainTime = formatTime(schedIso);

        const vtCode = deriveVtCode(s.stopId);
        const stopLive = vtCode && liveStops ? liveStops[vtCode] : null;

        const isCancelledStop = Boolean(liveTrain?.c || stopLive?.st === 3);
        const isPassed = !isCancelledStop && Boolean(stopLive?.st === 1 && stopLive?.t);

        let statusClass = 'is-upcoming';
        if (isCancelledStop) statusClass = 'is-cancelled-stop';
        else if (isPassed) statusClass = 'is-passed';
        else if (i === activeIdx) statusClass = 'is-active';
        else if (!liveTrain && activeIdx !== -1 && i < activeIdx) statusClass = 'is-past';

        if (i === activeIdx && !isCancelledStop) {
          statusClass += ' is-active';
        }

        let rightCellHtml = '';
        if (isCancelledStop) {
          rightCellHtml = buildDelayPillHtml(null, true, 'Soppressa');
        } else if (isPassed) {
          rightCellHtml = `
            <span class="stop-actual-time">Passato ${escapeHtml(stopLive.t)}</span>
            ${buildDelayPillHtml(stopLive.d, false)}
          `;
        } else if (liveTrain && !liveTrain.np && typeof liveTrain.r === 'number') {
          const estTime = addMinutesToIso(schedIso, liveTrain.r);
          rightCellHtml = `
            ${estTime ? `<span class="stop-actual-time is-est">Prev. ${escapeHtml(estTime)}</span>` : ''}
            ${buildDelayPillHtml(liveTrain.r, false)}
          `;
        } else {
          rightCellHtml = `<span class="stop-pending-label">Previsto</span>`;
        }

        return `
          <div class="stop-row ${statusClass}">
            <div class="stop-time-cell">
              <span>${escapeHtml(mainTime)}</span>
            </div>
            <div class="stop-rail-cell" aria-hidden="true">
              <div class="stop-rail-line"></div>
              <div class="stop-rail-dot"></div>
            </div>
            <div class="stop-name-cell">
              <span class="stop-name">${escapeHtml(stopName)}</span>
            </div>
            <div class="stop-status-cell">
              ${rightCellHtml}
            </div>
          </div>
        `;
      })
      .join('');

    els.trainSheetBody.innerHTML = `${bannerHtml}<div class="stops-timeline">${timelineHtml}</div>`;
  } catch {
    els.trainSheetBody.innerHTML = `
      <div class="state-card">
        <h3 class="state-title">Fermate non disponibili</h3>
        <p class="state-desc">Impossibile recuperare l'elenco completo delle fermate in questo momento.</p>
      </div>
    `;
  }
}

// ============================================================================
// Station Picker / Search Sheet
// ============================================================================

function openStationSheet(target = 'board') {
  state.stationPickerTarget = target;
  if (target === 'route-from') {
    els.stationSheetTitle.textContent = 'Stazione di partenza';
  } else if (target === 'route-to') {
    els.stationSheetTitle.textContent = 'Stazione di arrivo';
  } else {
    els.stationSheetTitle.textContent = 'Cerca o aggiungi stazione';
  }

  els.stationSearchInput.value = '';
  els.stationSearchClear.classList.add('hidden');
  els.stationSearchResults.innerHTML = '';
  els.pinnedManageSection.classList.remove('hidden');
  renderPinnedManageList();
  openSheet('station-sheet-backdrop');

  setTimeout(() => {
    els.stationSearchInput.focus();
  }, 160);
}

function renderPinnedManageList() {
  const isBoardTarget = state.stationPickerTarget === 'board';
  const frag = document.createDocumentFragment();

  for (const st of state.pinnedStations) {
    const row = document.createElement('div');
    row.className = 'pinned-manage-row';

    const selectBtn = document.createElement('button');
    selectBtn.type = 'button';
    selectBtn.style.cssText = 'flex:1; text-align:left; font-weight:700; font-size:0.92rem;';
    selectBtn.textContent = st.name;
    selectBtn.addEventListener('click', () => handleStationPicked(st));
    row.appendChild(selectBtn);

    if (isBoardTarget) {
      const actions = document.createElement('div');
      actions.className = 'pinned-manage-actions';

      const isHome = st.id === state.homeStationId;
      const homeBtn = document.createElement('button');
      homeBtn.type = 'button';
      homeBtn.className = `mini-btn${isHome ? ' is-home' : ''}`;
      homeBtn.textContent = isHome ? 'Principale' : 'Imposta home';
      homeBtn.addEventListener('click', () => {
        state.homeStationId = st.id;
        localStorage.setItem(STORAGE_KEYS.HOME, st.id);
        renderPinnedStrip();
        renderPinnedManageList();
      });
      actions.appendChild(homeBtn);

      if (state.pinnedStations.length > 1) {
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'mini-btn danger';
        delBtn.setAttribute('aria-label', `Rimuovi ${st.name}`);
        delBtn.textContent = '×';
        delBtn.addEventListener('click', () => {
          state.pinnedStations = state.pinnedStations.filter((x) => x.id !== st.id);
          if (state.homeStationId === st.id) {
            state.homeStationId = state.pinnedStations[0].id;
            localStorage.setItem(STORAGE_KEYS.HOME, state.homeStationId);
          }
          savePinnedStations();
          if (state.activeStation?.id === st.id) {
            selectActiveStation(state.pinnedStations[0]);
          } else {
            renderPinnedStrip();
          }
          renderPinnedManageList();
        });
        actions.appendChild(delBtn);
      }

      row.appendChild(actions);
    }

    frag.appendChild(row);
  }

  els.pinnedManageList.innerHTML = '';
  els.pinnedManageList.appendChild(frag);
}

let searchDebounce = null;
function handleStationSearchInput() {
  const q = els.stationSearchInput.value.trim();
  els.stationSearchClear.classList.toggle('hidden', q.length === 0);

  if (q.length < 2) {
    els.stationSearchResults.innerHTML = '';
    els.pinnedManageSection.classList.remove('hidden');
    return;
  }

  els.pinnedManageSection.classList.add('hidden');
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(async () => {
    if (state.searchAbort) state.searchAbort.abort();
    const controller = new AbortController();
    state.searchAbort = controller;

    els.stationSearchResults.innerHTML = `<div class="skeleton-card" style="height:50px;"></div><div class="skeleton-card" style="height:50px;"></div>`;

    try {
      const results = await searchItalianRailStations(q, controller.signal);
      if (controller.signal.aborted) return;

      if (results.length === 0) {
        els.stationSearchResults.innerHTML = `<p class="settings-hint" style="padding: 8px 2px;">Nessuna stazione ferroviaria trovata per "${escapeHtml(q)}".</p>`;
        return;
      }

      const frag = document.createDocumentFragment();
      for (const st of results) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'station-result-item';
        const isPinned = state.pinnedStations.some((p) => p.id === st.id);
        btn.innerHTML = `
          <div>
            <div class="station-result-name">${escapeHtml(st.name)}</div>
            <div class="station-result-meta">${escapeHtml(st.area || 'Stazione ferroviaria')}</div>
          </div>
          <span class="mini-btn">${isPinned ? 'Apri' : '+ Aggiungi'}</span>
        `;
        btn.addEventListener('click', () => handleStationPicked(st));
        frag.appendChild(btn);
      }
      els.stationSearchResults.innerHTML = '';
      els.stationSearchResults.appendChild(frag);
    } catch (err) {
      if (err.name === 'AbortError') return;
      els.stationSearchResults.innerHTML = `<p class="settings-hint">Errore durante la ricerca. Riprova.</p>`;
    }
  }, 240);
}

function handleStationPicked(station) {
  closeSheet('station-sheet-backdrop');
  if (state.stationPickerTarget === 'route-from') {
    state.routeFrom = station;
    updateRouteInputsUI();
    runRouteSearch();
    return;
  }
  if (state.stationPickerTarget === 'route-to') {
    state.routeTo = station;
    updateRouteInputsUI();
    runRouteSearch();
    return;
  }
  pinAndSelectStation(station);
}

function pinAndSelectStation(station) {
  if (!state.pinnedStations.some((s) => s.id === station.id)) {
    state.pinnedStations.push({
      id: station.id,
      name: station.name,
      vtCode: station.vtCode || deriveVtCode(station.id),
      rfiId: station.rfiId || null,
    });
    savePinnedStations();
  }
  selectActiveStation(station);
}

function selectActiveStation(station) {
  state.activeStation = station;
  state.activeDirection = 'ALL';
  updateHeaderUI();
  renderPinnedStrip();
  loadBoard();
}

// ============================================================================
// Route Planner ("Cerca percorso" Da -> A)
// ============================================================================

function updateRouteInputsUI() {
  els.routeFromLabel.textContent = state.routeFrom.name;
  els.routeToLabel.textContent = state.routeTo.name;
}

async function runRouteSearch() {
  if (!state.routeFrom || !state.routeTo) return;

  if (state.routeAbort) state.routeAbort.abort();
  const controller = new AbortController();
  state.routeAbort = controller;

  renderSkeletons(els.routeResultsList, 4);

  const when = els.routeDatetimeInput.value
    ? parseRomeDatetimeLocal(els.routeDatetimeInput.value)
    : new Date();

  const url = `${TRANSITOUS_BASE}/plan?fromPlace=${encodeURIComponent(state.routeFrom.id)}&toPlace=${encodeURIComponent(state.routeTo.id)}&transitModes=RAIL&time=${encodeURIComponent(when.toISOString())}&numItineraries=6`;

  try {
    const data = await fetchJson(url, controller.signal);
    if (controller.signal.aborted) return;

    const rawItineraries = Array.isArray(data.itineraries) ? data.itineraries : [];
    // Filter out itineraries that have non-rail transit legs when searching trains, and dedupe identical start/end
    const itineraries = rawItineraries.filter((it) => {
      const transitLegs = (it.legs || []).filter((l) => l.mode !== 'WALK');
      return transitLegs.length > 0 && transitLegs.every((l) => RAIL_MODES.has(l.mode));
    });

    if (itineraries.length === 0) {
      els.routeResultsList.innerHTML = `
        <div class="state-card">
          <h3 class="state-title">Nessuna soluzione trovata</h3>
          <p class="state-desc">Prova a scegliere un altro orario o verifica le stazioni selezionate.</p>
        </div>
      `;
      return;
    }

    const html = itineraries
      .map((it, idx) => {
        const railLegs = (it.legs || []).filter((l) => RAIL_MODES.has(l.mode));
        const legsBadges = railLegs
          .map((l) => {
            const meta = extractTrainMeta({
              mode: l.mode,
              displayName: l.routeShortName || l.displayName,
              tripShortName: l.tripShortName,
              agencyName: l.agencyName,
            });
            const label =
              meta.number && !meta.line.includes(meta.number)
                ? `${meta.line} ${meta.number}`
                : meta.line;
            return `<span class="line-badge ${meta.badgeClass}">${escapeHtml(label)}</span>`;
          })
          .join('<span aria-hidden="true">→</span>');

        const realTransfers = Math.max(0, railLegs.length - 1);
        const transferText =
          realTransfers === 0
            ? 'Diretto'
            : realTransfers === 1
              ? '1 cambio'
              : `${realTransfers} cambi`;

        const firstRail = railLegs[0];
        const subtitle =
          railLegs.length > 1
            ? `Cambio a ${cleanStationDisplayName(railLegs[0].to.name)}`
            : firstRail?.agencyName || '';

        return `
          <button type="button" class="itinerary-card" data-itinerary-idx="${idx}">
            <div class="itinerary-top">
              <div class="itinerary-times">
                <span>${escapeHtml(formatTime(it.startTime))}</span>
                <span class="itinerary-arrow" aria-hidden="true">→</span>
                <span>${escapeHtml(formatTime(it.endTime))}</span>
              </div>
              <span class="itinerary-duration">${escapeHtml(formatDuration(it.duration))}</span>
            </div>
            <div class="itinerary-legs">
              ${legsBadges}
              <span class="transfer-badge">· ${escapeHtml(transferText)}</span>
              ${subtitle ? `<span class="train-agency">· ${escapeHtml(subtitle)}</span>` : ''}
            </div>
          </button>
        `;
      })
      .join('');

    els.routeResultsList.innerHTML = html;

    els.routeResultsList.querySelectorAll('.itinerary-card').forEach((card) => {
      card.addEventListener('click', () => {
        const idx = Number(card.dataset.itineraryIdx);
        const it = itineraries[idx];
        const firstRail = (it?.legs || []).find((l) => RAIL_MODES.has(l.mode) && l.tripId);
        if (firstRail) {
          openTrainDetailSheet({
            tripId: firstRail.tripId,
            mode: firstRail.mode,
            displayName: firstRail.routeShortName,
            tripShortName: firstRail.tripShortName,
            headsign: firstRail.headsign || firstRail.to?.name,
            agencyName: firstRail.agencyName,
          });
        }
      });
    });
  } catch (err) {
    if (err.name === 'AbortError') return;
    els.routeResultsList.innerHTML = `
      <div class="state-card">
        <h3 class="state-title">Errore nella ricerca percorso</h3>
        <p class="state-desc">Controlla la connessione e riprova.</p>
        <button type="button" id="retry-route-btn" class="primary-btn">Riprova</button>
      </div>
    `;
    $('retry-route-btn')?.addEventListener('click', runRouteSearch);
  }
}

// ============================================================================
// View Switching & Sheets
// ============================================================================

function switchView(view) {
  state.view = view;
  const isBoard = view === 'board';
  els.boardView.classList.toggle('hidden', !isBoard);
  els.routeView.classList.toggle('hidden', isBoard);
  els.tabBoard.classList.toggle('active', isBoard);
  els.tabRoute.classList.toggle('active', !isBoard);
  els.tabBoard.setAttribute('aria-selected', String(isBoard));
  els.tabRoute.setAttribute('aria-selected', String(!isBoard));

  if (!isBoard) {
    if (!els.routeDatetimeInput.value) {
      els.routeDatetimeInput.value = toDatetimeLocalValue(new Date());
    }
    if (els.routeResultsList.children.length === 0) {
      runRouteSearch();
    }
  }
}

function openSheet(id) {
  const el = $(id);
  if (!el) return;
  el.classList.add('open');
  el.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeSheet(id) {
  const el = $(id);
  if (!el) return;
  el.classList.remove('open');
  el.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function updateTimePresetPills() {
  els.timePresetsRow.querySelectorAll('.time-pill').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.timePreset === state.timePreset);
  });
}

// ============================================================================
// Event Bindings & Bootstrap
// ============================================================================

function bindEvents() {
  // Header
  els.stationHeaderBtn.addEventListener('click', () => openStationSheet('board'));
  els.themeToggleBtn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });

  // View tabs
  els.tabBoard.addEventListener('click', () => switchView('board'));
  els.tabRoute.addEventListener('click', () => switchView('route'));

  // Departures / Arrivals toggle
  els.modeDepartures.addEventListener('click', () => {
    if (state.boardMode === 'departures') return;
    state.boardMode = 'departures';
    els.modeDepartures.classList.add('active');
    els.modeArrivals.classList.remove('active');
    els.modeDepartures.setAttribute('aria-pressed', 'true');
    els.modeArrivals.setAttribute('aria-pressed', 'false');
    updateHeaderUI();
    loadBoard();
  });

  els.modeArrivals.addEventListener('click', () => {
    if (state.boardMode === 'arrivals') return;
    state.boardMode = 'arrivals';
    els.modeArrivals.classList.add('active');
    els.modeDepartures.classList.remove('active');
    els.modeArrivals.setAttribute('aria-pressed', 'true');
    els.modeDepartures.setAttribute('aria-pressed', 'false');
    updateHeaderUI();
    loadBoard();
  });

  // Refresh button
  els.refreshBtn.addEventListener('click', () => loadBoard());

  // Quick time presets
  els.timePresetsRow.querySelectorAll('.time-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.timePreset;
      if (preset === 'custom') {
        const willOpen = els.customTimeBox.classList.contains('hidden');
        els.customTimeBox.classList.toggle('hidden', !willOpen);
        if (willOpen) {
          els.boardDatetimeInput.value = toDatetimeLocalValue(state.targetDate);
          els.boardDatetimeInput.focus();
        }
        return;
      }
      els.customTimeBox.classList.add('hidden');
      state.timePreset = preset;
      updateTimePresetPills();
      loadBoard();
    });
  });

  els.applyCustomTimeBtn.addEventListener('click', () => {
    if (!els.boardDatetimeInput.value) return;
    state.targetDate = parseRomeDatetimeLocal(els.boardDatetimeInput.value);
    state.timePreset = 'custom';
    updateTimePresetPills();
    els.customTimeBox.classList.add('hidden');
    loadBoard();
  });

  // Pagination
  els.pageEarlierBtn.addEventListener('click', () => {
    if (state.boardMode === 'arrivals') {
      state.targetDate = new Date(state.targetDate.getTime() - 2 * 60 * 60 * 1000);
      state.timePreset = 'custom';
      updateTimePresetPills();
      loadBoard();
      return;
    }
    if (state.prevCursor) {
      state.timePreset = 'cursor';
      updateTimePresetPills();
      loadBoard({ cursor: state.prevCursor });
    }
  });

  els.pageNowBtn.addEventListener('click', () => {
    state.timePreset = 'now';
    updateTimePresetPills();
    els.customTimeBox.classList.add('hidden');
    loadBoard();
  });

  els.pageLaterBtn.addEventListener('click', () => {
    if (state.boardMode === 'arrivals') {
      state.targetDate = new Date(state.targetDate.getTime() + 2 * 60 * 60 * 1000);
      state.timePreset = 'custom';
      updateTimePresetPills();
      loadBoard();
      return;
    }
    if (state.nextCursor) {
      state.timePreset = 'cursor';
      updateTimePresetPills();
      loadBoard({ cursor: state.nextCursor });
    }
  });

  // Route planner
  els.routeFromBtn.addEventListener('click', () => openStationSheet('route-from'));
  els.routeToBtn.addEventListener('click', () => openStationSheet('route-to'));
  els.routeSwapBtn.addEventListener('click', () => {
    const tmp = state.routeFrom;
    state.routeFrom = state.routeTo;
    state.routeTo = tmp;
    updateRouteInputsUI();
    runRouteSearch();
  });
  els.routeSearchBtn.addEventListener('click', runRouteSearch);

  document.querySelectorAll('[data-route-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pair = ROUTE_PRESETS[btn.dataset.routePreset];
      if (!pair) return;
      state.routeFrom = pair[0];
      state.routeTo = pair[1];
      updateRouteInputsUI();
      runRouteSearch();
    });
  });

  // Station search
  els.stationSearchInput.addEventListener('input', handleStationSearchInput);
  els.stationSearchClear.addEventListener('click', () => {
    els.stationSearchInput.value = '';
    handleStationSearchInput();
    els.stationSearchInput.focus();
  });

  // Sheet closing (close buttons, backdrop click, Escape key)
  document.querySelectorAll('[data-close-sheet]').forEach((btn) => {
    btn.addEventListener('click', () => closeSheet(btn.dataset.closeSheet));
  });

  document.querySelectorAll('.sheet-backdrop').forEach((backdrop) => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeSheet(backdrop.id);
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.sheet-backdrop.open').forEach((b) => closeSheet(b.id));
    }
  });
}

function resolveInitialStation() {
  try {
    const params = new URLSearchParams(window.location.search);
    const paramId = params.get('station');
    const paramName = params.get('name');
    if (paramId) {
      const existing = state.pinnedStations.find((s) => s.id === paramId);
      if (existing) return existing;
      if (paramName) {
        const def = DEFAULT_STATIONS.find((d) => d.id === paramId);
        return {
          id: paramId,
          name: paramName,
          vtCode: def?.vtCode || deriveVtCode(paramId),
          rfiId: def?.rfiId || null,
        };
      }
    }
  } catch {
    // ignore
  }
  return (
    state.pinnedStations.find((s) => s.id === state.homeStationId) ||
    state.pinnedStations[0] ||
    DEFAULT_STATIONS[0]
  );
}

function init() {
  initTheme();
  bindEvents();
  updateRouteInputsUI();
  els.routeDatetimeInput.value = toDatetimeLocalValue(new Date());

  state.activeStation = resolveInitialStation();
  updateHeaderUI();
  renderPinnedStrip();
  loadBoard();

  // Auto-refresh every 60s when viewing live "Adesso" board
  setInterval(() => {
    if (document.visibilityState === 'visible' && state.view === 'board' && state.timePreset === 'now' && !state.isLoading) {
      loadBoard();
    }
  }, 60000);
}

init();
