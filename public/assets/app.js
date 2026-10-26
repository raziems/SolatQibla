/* Solat & Qibla — prayer times (JAKIM zones + worldwide) with a qibla compass.
   Plain JS, hash router, no build step. Data sources:
     - api.waktusolat.app  (JAKIM e-Solat zones, Malaysia)
     - api.aladhan.com     (worldwide prayer times, 20+ calculation methods)
     - ummahapi.com        (qibla direction; Aladhan as fallback)
     - nominatim.openstreetmap.org (place search / reverse geocoding) */
(() => {
  'use strict';

  /* ---------- helpers ---------- */
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = $('#app');
  const pad = (n) => String(n).padStart(2, '0');

  const store = {
    get(key, fallback) {
      try { const v = JSON.parse(localStorage.getItem(key)); return v === null || v === undefined ? fallback : v; } catch { return fallback; }
    },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ } },
    remove(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
  };

  let toastTimer;
  function toast(msg, isError) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast' + (isError ? ' err' : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 5000 : 2500);
  }

  /* ---------- constants ---------- */
  const WS = 'https://api.waktusolat.app';
  const AL = 'https://api.aladhan.com/v1';
  const UMMAH = 'https://ummahapi.com/api/qibla';
  const NOMINATIM = 'https://nominatim.openstreetmap.org';
  const MY_TZ = 'Asia/Kuala_Lumpur';
  const KEYS = { current: 'sq_current', favs: 'sq_favs', settings: 'sq_settings', cache: 'sq_cache:' };

  const NAMES = {
    ms: { imsak: 'Imsak', fajr: 'Subuh', syuruk: 'Syuruk', dhuha: 'Dhuha', dhuhr: 'Zohor', asr: 'Asar', maghrib: 'Maghrib', isha: 'Isyak' },
    en: { imsak: 'Imsak', fajr: 'Fajr', syuruk: 'Sunrise', dhuha: 'Duha', dhuhr: 'Dhuhr', asr: 'Asr', maghrib: 'Maghrib', isha: 'Isha' },
  };
  const MAIN = ['fajr', 'syuruk', 'dhuhr', 'asr', 'maghrib', 'isha'];
  const EXTRA = ['imsak', 'fajr', 'syuruk', 'dhuha', 'dhuhr', 'asr', 'maghrib', 'isha'];
  const HIJRI_MONTHS = {
    ms: ['Muharram', 'Safar', 'Rabiulawal', 'Rabiulakhir', 'Jamadilawal', 'Jamadilakhir', 'Rejab', 'Syaaban', 'Ramadan', 'Syawal', 'Zulkaedah', 'Zulhijjah'],
    en: ['Muharram', 'Safar', "Rabi' al-Awwal", "Rabi' al-Thani", 'Jumada al-Ula', 'Jumada al-Thani', 'Rajab', "Sha'ban", 'Ramadan', 'Shawwal', "Dhu al-Qi'dah", 'Dhu al-Hijjah'],
  };
  const METHODS = [
    [3, 'Muslim World League'], [2, 'ISNA (North America)'], [5, 'Egyptian General Authority of Survey'],
    [4, 'Umm Al-Qura University, Makkah'], [1, 'University of Islamic Sciences, Karachi'], [7, 'Institute of Geophysics, Tehran'],
    [0, 'Shia Ithna-Ashari, Qum'], [8, 'Gulf Region'], [9, 'Kuwait'], [10, 'Qatar'], [11, 'MUIS Singapore'],
    [12, 'UOIF France'], [13, 'Diyanet, Turkey'], [14, 'Spiritual Administration of Muslims of Russia'],
    [15, 'Moonsighting Committee Worldwide'], [16, 'Dubai'], [17, 'JAKIM Malaysia'], [18, 'Tunisia'], [19, 'Algeria'],
    [20, 'Kementerian Agama Indonesia'], [21, 'Morocco'], [22, 'Comunidade Islamica de Lisboa'], [23, 'Ministry of Awqaf, Jordan'],
  ];
  const CC_METHOD = {
    my: 17, sg: 11, id: 20, sa: 4, ae: 16, kw: 9, qa: 10, bh: 8, om: 8, eg: 5, sd: 5, ly: 5, pk: 1, bd: 1, in: 1, af: 1,
    tr: 13, ir: 7, ru: 14, fr: 12, us: 2, ca: 2, tn: 18, dz: 19, ma: 21, pt: 22, jo: 23,
  };
  const DEFAULT_SETTINGS = { names: 'ms', clock: '12', method: 'auto', school: 0, extra: false, theme: 'auto' };
  const DEFAULT_LOCATION = { id: 'jakim:PNG01', kind: 'jakim', zone: 'PNG01', cc: 'my', label: 'Pulau Pinang', sub: 'PNG01 · Pulau Pinang' };

  /* ---------- state ---------- */
  let settings = { ...DEFAULT_SETTINGS, ...store.get(KEYS.settings, {}) };
  let favs = store.get(KEYS.favs, []);
  let current = store.get(KEYS.current, null) || DEFAULT_LOCATION;
  let zonesCache = null;
  let tickTimer;
  let orientationHandler;

  function saveSettings() { store.set(KEYS.settings, settings); applyTheme(); }
  function saveFavs() { store.set(KEYS.favs, favs); }
  function setCurrent(loc) {
    current = loc;
    store.set(KEYS.current, loc);
    // keep the favourite copy in sync (e.g. coordinates added later)
    const i = favs.findIndex((f) => f.id === loc.id);
    if (i >= 0) { favs[i] = { ...favs[i], ...loc, label: favs[i].label }; saveFavs(); }
  }
  const isFav = (loc) => favs.some((f) => f.id === loc.id);
  function toggleFav(loc) {
    if (isFav(loc)) { favs = favs.filter((f) => f.id !== loc.id); toast('Removed from favourites'); }
    else { favs.push({ ...loc }); toast('Saved to favourites'); }
    saveFavs();
  }
  function applyTheme() {
    if (settings.theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', settings.theme);
  }

  /* ---------- fetch + cache ---------- */
  async function fetchJson(url, opts) {
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error(`service returned ${res.status}`);
    return res.json();
  }
  async function fetchJsonCached(key, url, maxAgeMs) {
    const k = KEYS.cache + key;
    const c = store.get(k, null);
    if (c && Date.now() - c.at < maxAgeMs) return c.data;
    try {
      const data = await fetchJson(url);
      store.set(k, { at: Date.now(), data });
      return data;
    } catch (e) {
      if (c) return c.data; // offline: serve stale cache rather than nothing
      throw e;
    }
  }
  function clearCache() {
    Object.keys(localStorage).filter((k) => k.startsWith(KEYS.cache)).forEach((k) => store.remove(k));
  }

  async function getZones() {
    if (!zonesCache) zonesCache = await fetchJsonCached('zones', `${WS}/zones`, 30 * 86400000);
    return zonesCache;
  }
  const zoneInfo = (zones, code) => zones.find((z) => z.jakimCode === code);
  /* JAKIM district strings are mostly title case, but a few are SHOUTED ("SELURUH NEGERI PULAU PINANG"). */
  const titleCase = (s) => (s === s.toUpperCase() ? s.toLowerCase().replace(/(^|\s|\()\S/g, (c) => c.toUpperCase()) : s);
  const zoneDistrict = (z) => titleCase(z.daerah.split(',')[0].trim()).replace(/^Seluruh Negeri /i, '');

  /* ---------- dates & times ---------- */
  const dateKey = (ms, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  const ymd = (key) => key.split('-').map(Number);
  function addDays(key, n) { const [y, m, d] = ymd(key); const dt = new Date(Date.UTC(y, m - 1, d + n)); return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`; }
  const fmtTime = (ms, tz) => new Date(ms).toLocaleTimeString(settings.clock === '12' ? 'en-US' : 'en-GB', { hour: '2-digit', minute: '2-digit', hour12: settings.clock === '12', timeZone: tz });
  const fmtDate = (ms, tz) => new Date(ms).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: tz });
  const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const names = () => NAMES[settings.names] || NAMES.ms;
  function hijriLabel(h) {
    if (!h) return '';
    const months = HIJRI_MONTHS[settings.names] || HIJRI_MONTHS.ms;
    return `${h.d} ${months[h.m - 1] || h.m} ${h.y}H`;
  }
  function countdown(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h ? `${h}h ${pad(m)}m ${pad(sec)}s` : `${m}m ${pad(sec)}s`;
  }

  /* ---------- prayer data (normalised) ----------
     Each month → { tz, source, days: [{ date: 'YYYY-MM-DD', hijri: {d,m,y}, times: { fajr: epochMs, … } }] } */
  function methodFor(loc) {
    const m = loc.method ?? settings.method;
    if (m !== 'auto' && m !== undefined && m !== null && m !== '') return Number(m);
    return CC_METHOD[(loc.cc || '').toLowerCase()] ?? 3;
  }
  const methodName = (id) => (METHODS.find(([i]) => i === id) || [id, `Method ${id}`])[1];

  async function getMonth(loc, y, m) {
    if (loc.kind === 'jakim') {
      const data = await fetchJsonCached(`jakim:${loc.zone}:${y}-${m}`, `${WS}/v2/solat/${encodeURIComponent(loc.zone)}?year=${y}&month=${m}`, 12 * 3600000);
      const days = (data.prayers || []).map((p) => {
        const [hy, hm, hd] = String(p.hijri || '').split('-').map(Number);
        const times = {};
        for (const k of EXTRA) if (p[k]) times[k] = p[k] * 1000;
        return { date: `${y}-${pad(m)}-${pad(p.day)}`, hijri: hy ? { d: hd, m: hm, y: hy } : null, times };
      });
      return { tz: MY_TZ, source: 'JAKIM e-Solat', days };
    }
    const method = methodFor(loc);
    const school = Number(settings.school) || 0;
    const url = `${AL}/calendar/${y}/${m}?latitude=${loc.lat}&longitude=${loc.lon}&method=${method}&school=${school}&iso8601=true`;
    const data = await fetchJsonCached(`al:${loc.lat.toFixed(3)},${loc.lon.toFixed(3)}:${method}:${school}:${y}-${m}`, url, 12 * 3600000);
    if (!Array.isArray(data.data)) throw new Error(data.data || 'unexpected response');
    const map = { Imsak: 'imsak', Fajr: 'fajr', Sunrise: 'syuruk', Dhuhr: 'dhuhr', Asr: 'asr', Maghrib: 'maghrib', Isha: 'isha' };
    const days = data.data.map((d) => {
      const [gd, gm, gy] = d.date.gregorian.date.split('-').map(Number);
      const [hd, hm, hy] = d.date.hijri.date.split('-').map(Number);
      const times = {};
      for (const [k, v] of Object.entries(map)) { const t = Date.parse(d.timings[k]); if (!Number.isNaN(t)) times[v] = t; }
      return { date: `${gy}-${pad(gm)}-${pad(gd)}`, hijri: { d: hd, m: hm, y: hy }, times };
    });
    const meta = data.data[0]?.meta || {};
    return { tz: meta.timezone || deviceTz, source: `Aladhan · ${meta.method?.name || methodName(method)}`, days };
  }

  /* Loads this month plus the next one when tomorrow falls in it, so "Subuh tomorrow" always has a time. */
  async function loadTimes(loc) {
    const tz = loc.kind === 'jakim' ? MY_TZ : (loc.tz || deviceTz);
    const today = dateKey(Date.now(), tz);
    const [y, m] = ymd(today);
    const month = await getMonth(loc, y, m);
    const tomorrow = addDays(today, 1);
    const [ty, tm] = ymd(tomorrow);
    let days = month.days;
    if (tm !== m) {
      try { const next = await getMonth(loc, ty, tm); days = days.concat(next.days); } catch { /* fine, just no tomorrow time */ }
    }
    return { ...month, days, today: dateKey(Date.now(), month.tz) };
  }

  /* ---------- location helpers ---------- */
  const locId = (loc) => (loc.kind === 'jakim' ? `jakim:${loc.zone}` : `geo:${loc.lat.toFixed(3)},${loc.lon.toFixed(3)}`);
  function labelFromAddress(a, fallback) {
    const label = a.city || a.town || a.village || a.municipality || a.county || a.state_district || a.state || fallback || 'Unknown place';
    const sub = [a.state && a.state !== label ? a.state : null, a.country].filter(Boolean).join(', ');
    return { label, sub };
  }
  async function reverseGeocode(lat, lon) {
    try {
      const r = await fetchJson(`${NOMINATIM}/reverse?lat=${lat}&lon=${lon}&format=jsonv2&zoom=10&accept-language=en`);
      return { ...labelFromAddress(r.address || {}, r.name), cc: r.address?.country_code || '' };
    } catch {
      return { label: `${lat.toFixed(3)}, ${lon.toFixed(3)}`, sub: 'GPS position', cc: '' };
    }
  }
  async function searchPlaces(q) {
    const r = await fetchJson(`${NOMINATIM}/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=8&addressdetails=1&accept-language=en`);
    return r.map((p) => ({ ...labelFromAddress(p.address || {}, p.name), label: p.name || labelFromAddress(p.address || {}).label, display: p.display_name, lat: Number(p.lat), lon: Number(p.lon), cc: p.address?.country_code || '' }));
  }
  /* Build a location from coordinates: Malaysian coordinates become a JAKIM zone, anything else uses Aladhan. */
  async function locationFromCoords(lat, lon) {
    const geo = await reverseGeocode(lat, lon);
    if (geo.cc === 'my') {
      try {
        const z = await fetchJson(`${WS}/zones/${lat}/${lon}`);
        if (z.zone) {
          const zones = await getZones();
          const info = zoneInfo(zones, z.zone);
          return { id: `jakim:${z.zone}`, kind: 'jakim', zone: z.zone, lat, lon, cc: 'my', label: geo.label, sub: info ? `${z.zone} · ${info.negeri}` : z.zone };
        }
      } catch { /* fall through to worldwide */ }
    }
    return { id: locId({ kind: 'geo', lat, lon }), kind: 'geo', lat, lon, cc: geo.cc, label: geo.label, sub: geo.sub };
  }
  function getGps() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('This browser has no location support'));
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        (err) => reject(new Error(err.code === 1 ? 'Location permission was denied' : 'Could not get your position')),
        { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
      );
    });
  }
  /* Coordinates for the qibla page: zone-only locations get geocoded from the district name once. */
  async function ensureCoords(loc) {
    if (typeof loc.lat === 'number' && typeof loc.lon === 'number') return loc;
    if (loc.kind !== 'jakim') throw new Error('Location has no coordinates');
    const zones = await getZones();
    const info = zoneInfo(zones, loc.zone);
    const candidates = info
      ? [`${zoneDistrict(info)}, ${info.negeri}, Malaysia`, `${info.negeri}, Malaysia`]
      : [`${loc.label}, Malaysia`];
    let hit = null;
    for (const q of candidates) {
      const r = await fetchJson(`${NOMINATIM}/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=1&countrycodes=my`);
      if (r.length) { hit = r[0]; break; }
    }
    if (!hit) throw new Error(`Could not find coordinates for ${candidates[0]}`);
    const updated = { ...loc, lat: Number(hit.lat), lon: Number(hit.lon), cc: 'my' };
    if (current.id === loc.id) setCurrent(updated);
    return updated;
  }
  const kindBadge = (loc) => (loc.kind === 'jakim' ? '<span class="badge my">JAKIM</span>' : '<span class="badge world">Worldwide</span>');

  /* ---------- router ---------- */
  function route() {
    const path = location.hash.replace(/^#\/?/, '').split('?')[0];
    $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === path));
    clearInterval(tickTimer);
    if (orientationHandler) { window.removeEventListener('deviceorientationabsolute', orientationHandler); window.removeEventListener('deviceorientation', orientationHandler); orientationHandler = null; }
    const pages = { '': renderPrayer, qibla: renderQibla, locations: renderLocations, settings: renderSettings };
    (pages[path] || renderPrayer)().catch((e) => { app.innerHTML = `<div class="card"><div class="empty">Something went wrong: ${esc(e.message)}</div></div>`; });
  }
  window.addEventListener('hashchange', route);

  /* ---------- favourites chips (shared) ---------- */
  function chipsHtml() {
    if (!favs.length) return '';
    return `<div class="chips">${favs.map((f) => `<button class="chip ${f.id === current.id ? 'active' : ''}" data-act="use-fav" data-id="${esc(f.id)}" title="${esc(f.sub || '')}"><span>${f.kind === 'jakim' ? '🕌 ' : '🌍 '}${esc(f.label)}</span></button>`).join('')}</div>`;
  }
  function bindChips(el, after) {
    $$('[data-act="use-fav"]', el).forEach((b) => b.addEventListener('click', () => {
      const f = favs.find((x) => x.id === b.dataset.id);
      if (f) { setCurrent(f); after(); }
    }));
  }

  /* ---------- page: prayer times ---------- */
  async function renderPrayer() {
    app.innerHTML = `${chipsHtml()}<div class="card" id="prayer"><p class="muted">Loading prayer times for ${esc(current.label)}…</p></div><div id="month"></div>`;
    bindChips(app, renderPrayer);
    let data;
    try {
      data = await loadTimes(current);
    } catch (e) {
      $('#prayer').innerHTML = `<div class="loc-head"><div><div class="loc-name">${esc(current.label)}</div><div class="loc-sub">${esc(current.sub || '')}</div></div><span class="spacer"></span><a class="btn sm" href="#/locations">Change location</a></div><div class="empty">Prayer times unavailable (${esc(e.message)}). Check your connection and try again.</div>`;
      return;
    }
    const N = names();
    const list = settings.extra ? EXTRA : MAIN;
    const seq = MAIN; // order used for "next prayer"
    let lastNextKey = null;

    const draw = () => {
      const box = $('#prayer');
      if (!box) { clearInterval(tickTimer); return; }
      const now = Date.now();
      const todayKey = dateKey(now, data.tz);
      if (todayKey !== data.today) { renderPrayer(); return; } // day rolled over
      const today = data.days.find((d) => d.date === todayKey);
      const tomorrow = data.days.find((d) => d.date === addDays(todayKey, 1));
      let next = null, nextDay = 'today';
      if (today) {
        const k = seq.find((p) => today.times[p] > now);
        if (k) next = { key: k, at: today.times[k] };
        else if (tomorrow && tomorrow.times.fajr) { next = { key: 'fajr', at: tomorrow.times.fajr }; nextDay = 'tomorrow'; }
      }
      const nextKey = next ? `${next.key}@${next.at}` : 'none';
      if (nextKey === lastNextKey) { // only the countdown changes
        const c = $('#nextCount'); if (c && next) c.textContent = `in ${countdown(next.at - now)}`;
        return;
      }
      lastNextKey = nextKey;
      const times = today ? list.filter((k) => today.times[k]).map((k) => {
        const t = today.times[k];
        const cls = next && nextDay === 'today' && next.key === k ? 'next' : t <= now ? 'past' : '';
        return `<div class="ptime ${cls} ${MAIN.includes(k) ? '' : 'minor'}"><b>${esc(N[k])}</b>${fmtTime(t, data.tz)}</div>`;
      }).join('') : '<div class="empty">No times for today.</div>';
      const tzNote = data.tz !== deviceTz ? `<span class="tz-note">Times shown in ${esc(data.tz)} local time</span>` : '';
      box.innerHTML = `
        <div class="loc-head">
          <div><div class="loc-name">${esc(current.label)}</div><div class="loc-sub">${esc(current.sub || '')} ${kindBadge(current)}</div></div>
          <span class="spacer"></span>
          <button class="btn icon star ${isFav(current) ? 'on' : ''}" data-act="fav" title="${isFav(current) ? 'Remove from favourites' : 'Save as favourite'}">${isFav(current) ? '★' : '☆'}</button>
          <a class="btn sm" href="#/locations">Change</a>
        </div>
        ${next ? `<div class="next-box">
          <div><div class="n-label">Next prayer ${nextDay === 'tomorrow' ? '· tomorrow' : ''}</div><div class="n-name">${esc(N[next.key])}</div></div>
          <div class="n-time">${fmtTime(next.at, data.tz)}</div>
          <span class="spacer"></span>
          <div class="n-count" id="nextCount">in ${countdown(next.at - now)}</div>
        </div>` : ''}
        <div class="prayer-times ${settings.extra ? 'extra' : ''}">${times}</div>
        <div class="date-line">
          <span>${esc(fmtDate(now, data.tz))}</span>
          ${today?.hijri ? `<span>${esc(hijriLabel(today.hijri))}</span>` : ''}
          ${tzNote}
          <span class="muted">Source: ${esc(data.source)}</span>
        </div>`;
      $('[data-act="fav"]', box).addEventListener('click', () => { toggleFav(current); lastNextKey = null; renderPrayer(); });
    };
    draw();
    clearInterval(tickTimer);
    tickTimer = setInterval(draw, 1000);
    renderMonth(data, list);
  }

  function renderMonth(data, list) {
    const N = names();
    const [y, m] = ymd(data.today);
    const days = data.days.filter((d) => d.date.startsWith(`${y}-${pad(m)}`));
    const title = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const rows = days.map((d) => {
      const dt = new Date(Date.UTC(...ymd(d.date).map((v, i) => (i === 1 ? v - 1 : v))));
      const wd = dt.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
      const cls = [d.date === data.today ? 'today' : '', dt.getUTCDay() === 5 ? 'friday' : ''].join(' ');
      return `<tr class="${cls}"><td>${esc(wd)} ${Number(d.date.slice(-2))}</td>${list.map((k) => `<td>${d.times[k] ? fmtTime(d.times[k], data.tz) : '—'}</td>`).join('')}</tr>`;
    }).join('');
    $('#month').innerHTML = `
      <div class="card">
        <div class="card-head"><h2>${esc(title)}</h2><button class="btn sm" id="toggleMonth">Show month</button></div>
        <div class="table-wrap" id="monthTable" hidden><table class="month"><thead><tr><th>Day</th>${list.map((k) => `<th>${esc(N[k])}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
      </div>`;
    $('#toggleMonth').addEventListener('click', (ev) => {
      const t = $('#monthTable'); t.hidden = !t.hidden; ev.target.textContent = t.hidden ? 'Show month' : 'Hide month';
      if (!t.hidden) $('tr.today', t)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }

  /* ---------- page: qibla ---------- */
  async function renderQibla() {
    app.innerHTML = `${chipsHtml()}<div class="card" id="qibla"><p class="muted">Finding the qibla for ${esc(current.label)}…</p></div>`;
    bindChips(app, renderQibla);
    let loc, q;
    try {
      loc = await ensureCoords(current);
      q = await getQibla(loc.lat, loc.lon);
    } catch (e) {
      $('#qibla').innerHTML = `
        <div class="loc-head"><div><div class="loc-name">${esc(current.label)}</div><div class="loc-sub">${esc(current.sub || '')}</div></div><span class="spacer"></span><a class="btn sm" href="#/locations">Change</a></div>
        <div class="empty">Could not work out the qibla (${esc(e.message)}).</div>
        <p style="text-align:center"><button class="btn primary" id="gpsBtn">📍 Use my current position</button></p>`;
      $('#gpsBtn').addEventListener('click', () => useGps(renderQibla));
      return;
    }
    const bearing = q.direction;
    const canLive = 'DeviceOrientationEvent' in window;
    $('#qibla').innerHTML = `
      <div class="loc-head">
        <div><div class="loc-name">${esc(loc.label)}</div><div class="loc-sub">${esc(loc.sub || '')} · ${loc.lat.toFixed(4)}, ${loc.lon.toFixed(4)}</div></div>
        <span class="spacer"></span>
        <button class="btn sm" id="gpsBtn">📍 My position</button>
        <a class="btn sm" href="#/locations">Change</a>
      </div>
      <div class="qibla-wrap">
        ${compassSvg(bearing)}
        <div class="qibla-stats">
          <div class="stat"><div class="n">${bearing.toFixed(1)}°</div><div class="l">from true north</div></div>
          <div class="stat"><div class="n">${esc(q.compass || toCompass(bearing))}</div><div class="l">compass point</div></div>
          <div class="stat"><div class="n">${q.distanceKm ? Math.round(q.distanceKm).toLocaleString() + ' km' : '—'}</div><div class="l">to the Kaaba</div></div>
        </div>
        ${canLive ? `<button class="btn primary" id="liveBtn">🧭 Enable live compass</button><p class="small muted" id="liveNote">On a phone, the dial turns with the device: face the gold Kaaba marker when it is at the top.</p>` : '<p class="small muted">Open this page on a phone to use the live compass. The gold marker shows the qibla relative to true north.</p>'}
        <p class="small muted">Bearing is relative to true north. Magnetic compasses can differ by a few degrees depending on where you are.</p>
      </div>`;
    $('#gpsBtn').addEventListener('click', () => useGps(renderQibla));
    if (canLive) $('#liveBtn').addEventListener('click', () => startLiveCompass(bearing));
  }
  async function getQibla(lat, lon) {
    try {
      const r = await fetchJsonCached(`qibla:${lat.toFixed(3)},${lon.toFixed(3)}`, `${UMMAH}?lat=${lat}&lng=${lon}`, 365 * 86400000);
      const d = r.data || r;
      if (typeof d.qibla_direction !== 'number') throw new Error('unexpected response');
      return { direction: d.qibla_direction, compass: d.compass_bearing, distanceKm: d.distance_km, source: 'UmmahAPI' };
    } catch {
      const r = await fetchJsonCached(`qibla2:${lat.toFixed(3)},${lon.toFixed(3)}`, `${AL}/qibla/${lat}/${lon}`, 365 * 86400000);
      return { direction: r.data.direction, distanceKm: haversine(lat, lon, 21.4225, 39.8262), source: 'Aladhan' };
    }
  }
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371, toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  const toCompass = (deg) => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(deg / 22.5) % 16];
  function compassSvg(bearing) {
    const ticks = [];
    for (let a = 0; a < 360; a += 10) {
      const major = a % 90 === 0, mid = a % 30 === 0;
      const len = major ? 16 : mid ? 11 : 6;
      ticks.push(`<line class="tick ${major ? 'major' : ''}" x1="150" y1="22" x2="150" y2="${22 + len}" transform="rotate(${a} 150 150)"/>`);
    }
    const labels = [['N', 150, 58, 'n'], ['E', 242, 155, ''], ['S', 150, 252, ''], ['W', 58, 155, '']].map(([t, x, y, c]) => `<text class="${c}" x="${x}" y="${y}" text-anchor="middle">${t}</text>`).join('');
    return `
      <svg class="compass" viewBox="0 0 300 300" role="img" aria-label="Qibla compass showing ${bearing.toFixed(1)} degrees">
        <circle class="ring" cx="150" cy="150" r="140"/>
        <g class="dial" id="dial">
          ${ticks.join('')}${labels}
          <g transform="rotate(${bearing} 150 150)">
            <polygon class="needle" points="150,42 162,150 150,142 138,150"/>
            <polygon class="needle" points="150,258 162,150 150,158 138,150" opacity=".25"/>
            <rect class="kaaba" x="140" y="18" width="20" height="20" rx="3" transform="rotate(45 150 28)"/>
          </g>
        </g>
        <polygon class="heading-mark" points="150,2 158,14 142,14"/>
        <circle class="hub" cx="150" cy="150" r="9"/>
      </svg>`;
  }
  async function startLiveCompass(bearing) {
    const btn = $('#liveBtn'), note = $('#liveNote');
    try {
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        const p = await DeviceOrientationEvent.requestPermission();
        if (p !== 'granted') throw new Error('Compass permission was denied');
      }
    } catch (e) { toast(e.message, true); return; }
    let got = false;
    orientationHandler = (ev) => {
      let heading = null;
      if (typeof ev.webkitCompassHeading === 'number') heading = ev.webkitCompassHeading; // iOS
      else if (ev.absolute && typeof ev.alpha === 'number') heading = (360 - ev.alpha) % 360; // Android
      else if (typeof ev.alpha === 'number' && ev.type === 'deviceorientationabsolute') heading = (360 - ev.alpha) % 360;
      if (heading === null) return;
      got = true;
      const dial = $('#dial');
      if (dial) dial.style.transform = `rotate(${-heading}deg)`;
      const diff = ((bearing - heading + 540) % 360) - 180;
      if (note) note.innerHTML = Math.abs(diff) < 5 ? '<span class="live-on">✓ You are facing the qibla</span>' : `Turn ${diff > 0 ? 'right' : 'left'} ${Math.abs(Math.round(diff))}°`;
    };
    if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', orientationHandler);
    else window.addEventListener('deviceorientation', orientationHandler);
    btn.disabled = true; btn.textContent = '🧭 Live compass on';
    setTimeout(() => { if (!got && note) note.textContent = 'No compass readings yet. This needs a phone with a magnetometer and HTTPS.'; }, 3000);
  }

  /* ---------- page: locations ---------- */
  async function useGps(after) {
    toast('Getting your position…');
    try {
      const { lat, lon } = await getGps();
      const loc = await locationFromCoords(lat, lon);
      setCurrent(loc);
      toast(`Location set to ${loc.label}`);
      after();
    } catch (e) { toast(e.message, true); }
  }

  async function renderLocations() {
    app.innerHTML = `
      <div class="page-head"><h1>Locations</h1><span class="spacer"></span><span class="small muted">Current: <strong>${esc(current.label)}</strong> ${kindBadge(current)}</span></div>
      <div class="grid cols-2">
        <div class="card">
          <div class="card-head"><h2>Favourites</h2></div>
          <div id="favList"></div>
          <p class="small muted" style="margin-top:.75rem">Tap a favourite to use it. Star a location on the prayer times page to add it here. Favourites are stored in this browser.</p>
        </div>
        <div>
          <div class="card">
            <div class="card-head"><h2>Where are you?</h2></div>
            <p><button class="btn primary" id="gpsBtn">📍 Use my current position</button></p>
            <p class="small muted">In Malaysia this picks the official JAKIM zone for your position; elsewhere it uses the worldwide calculation.</p>
            <form id="searchForm" class="inline-form" style="margin-top:1rem">
              <input id="searchInput" placeholder="Search a city or place, e.g. Istanbul, Mecca, London" required autocomplete="off">
              <button class="btn">Search</button>
            </form>
            <ul class="results" id="results" hidden></ul>
          </div>
          <div class="card">
            <div class="card-head"><h2>Malaysia (JAKIM zone)</h2></div>
            <select id="zoneSelect"><option>Loading zones…</option></select>
            <p style="margin-top:.75rem"><button class="btn" id="zoneBtn">Use this zone</button></p>
          </div>
        </div>
      </div>`;
    drawFavList();
    $('#gpsBtn').addEventListener('click', () => useGps(() => { location.hash = '#/'; }));
    $('#searchForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const q = $('#searchInput').value.trim();
      const ul = $('#results');
      ul.hidden = false; ul.innerHTML = '<li class="muted">Searching…</li>';
      try {
        const results = await searchPlaces(q);
        if (!results.length) { ul.innerHTML = '<li class="muted">No places found.</li>'; return; }
        ul.innerHTML = results.map((r, i) => `<li data-i="${i}"><strong>${esc(r.label)}</strong><span class="small muted">${esc(r.display)}</span></li>`).join('');
        $$('li', ul).forEach((li) => li.addEventListener('click', async () => {
          const r = results[Number(li.dataset.i)];
          toast('Setting location…');
          const loc = r.cc === 'my' ? await locationFromCoords(r.lat, r.lon) : { id: locId({ kind: 'geo', lat: r.lat, lon: r.lon }), kind: 'geo', lat: r.lat, lon: r.lon, cc: r.cc, label: r.label, sub: r.sub };
          if (r.cc === 'my') loc.label = r.label;
          setCurrent(loc);
          location.hash = '#/';
        }));
      } catch (e) { ul.innerHTML = `<li class="muted">Search failed (${esc(e.message)})</li>`; }
    });
    try {
      const zones = await getZones();
      const byState = {};
      zones.forEach((z) => { (byState[z.negeri] ||= []).push(z); });
      const sel = $('#zoneSelect');
      if (!sel) return;
      sel.innerHTML = Object.keys(byState).sort().map((s) => `<optgroup label="${esc(s)}">${byState[s].map((z) => `<option value="${esc(z.jakimCode)}" ${current.kind === 'jakim' && current.zone === z.jakimCode ? 'selected' : ''}>${esc(z.jakimCode)} · ${esc(titleCase(z.daerah))}</option>`).join('')}</optgroup>`).join('');
      $('#zoneBtn').addEventListener('click', () => {
        const z = zoneInfo(zones, sel.value);
        if (!z) return;
        setCurrent({ id: `jakim:${z.jakimCode}`, kind: 'jakim', zone: z.jakimCode, cc: 'my', label: zoneDistrict(z), sub: `${z.jakimCode} · ${z.negeri}` });
        location.hash = '#/';
      });
    } catch (e) { const sel = $('#zoneSelect'); if (sel) sel.innerHTML = `<option>Zones unavailable (${esc(e.message)})</option>`; }
  }
  function drawFavList() {
    const box = $('#favList');
    if (!favs.length) { box.innerHTML = '<div class="empty">No favourites yet.</div>'; return; }
    box.innerHTML = `<ul class="list">${favs.map((f) => `
      <li class="clickable" data-id="${esc(f.id)}">
        <div class="body" data-act="use"><div class="title">${esc(f.label)} ${f.id === current.id ? '<span class="badge current">current</span>' : ''}</div><div class="meta">${kindBadge(f)}<span>${esc(f.sub || '')}</span></div></div>
        <div class="actions">
          <button class="btn sm icon" data-act="rename" title="Rename">✎</button>
          <button class="btn sm icon" data-act="up" title="Move up">↑</button>
          <button class="btn sm icon danger" data-act="remove" title="Remove">✕</button>
        </div>
      </li>`).join('')}</ul>`;
    $$('li', box).forEach((li) => {
      const id = li.dataset.id;
      const idx = () => favs.findIndex((f) => f.id === id);
      $('[data-act="use"]', li).addEventListener('click', () => { setCurrent(favs[idx()]); location.hash = '#/'; });
      $('[data-act="rename"]', li).addEventListener('click', () => {
        const f = favs[idx()];
        const name = prompt('Name for this favourite', f.label);
        if (name && name.trim()) { f.label = name.trim(); if (current.id === f.id) setCurrent({ ...current, label: f.label }); saveFavs(); drawFavList(); }
      });
      $('[data-act="up"]', li).addEventListener('click', () => {
        const i = idx(); if (i > 0) { [favs[i - 1], favs[i]] = [favs[i], favs[i - 1]]; saveFavs(); drawFavList(); }
      });
      $('[data-act="remove"]', li).addEventListener('click', () => { favs.splice(idx(), 1); saveFavs(); drawFavList(); });
    });
  }

  /* ---------- page: settings ---------- */
  async function renderSettings() {
    app.innerHTML = `
      <div class="page-head"><h1>Settings</h1></div>
      <div class="grid cols-2">
        <div class="card">
          <div class="card-head"><h2>Display</h2></div>
          <label>Prayer names
            <select data-setting="names"><option value="ms">Malay (Subuh, Zohor, Asar, Isyak)</option><option value="en">English (Fajr, Dhuhr, Asr, Isha)</option></select></label>
          <label>Time format
            <select data-setting="clock"><option value="12">12-hour (5:45 AM)</option><option value="24">24-hour (05:45)</option></select></label>
          <label>Theme
            <select data-setting="theme"><option value="auto">Follow device</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
          <label class="check"><input type="checkbox" data-setting="extra"> Also show Imsak and Dhuha</label>
        </div>
        <div class="card">
          <div class="card-head"><h2>Worldwide calculation</h2></div>
          <p class="small muted">Used for locations outside Malaysia (Aladhan). Malaysian zones always use the official JAKIM times.</p>
          <label>Calculation method
            <select data-setting="method"><option value="auto">Automatic (by country)</option>${METHODS.map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join('')}</select></label>
          <label>Asr (Asar) juristic method
            <select data-setting="school"><option value="0">Standard (Shafi'i, Maliki, Hanbali)</option><option value="1">Hanafi</option></select></label>
        </div>
        <div class="card">
          <div class="card-head"><h2>Data</h2></div>
          <p class="small muted">Prayer times are cached in this browser for 12 hours so the app also works briefly offline.</p>
          <button class="btn" id="clearCache">Clear cached times</button>
          <button class="btn danger" id="resetAll">Reset everything</button>
        </div>
        <div class="card">
          <div class="card-head"><h2>About</h2></div>
          <p class="small">Prayer times for Malaysia come from JAKIM e-Solat (via waktusolat.app); worldwide times from the Aladhan API. The qibla bearing comes from UmmahAPI. Place search uses OpenStreetMap Nominatim.</p>
          <p class="small muted">Add this page to your home screen for quick access when travelling.</p>
        </div>
      </div>`;
    $$('[data-setting]').forEach((el) => {
      const k = el.dataset.setting;
      if (el.type === 'checkbox') el.checked = Boolean(settings[k]); else el.value = String(settings[k]);
      el.addEventListener('change', () => {
        settings[k] = el.type === 'checkbox' ? el.checked : el.value;
        saveSettings();
        toast('Saved');
      });
    });
    $('#clearCache').addEventListener('click', () => { clearCache(); zonesCache = null; toast('Cache cleared'); });
    $('#resetAll').addEventListener('click', () => {
      if (!confirm('Remove favourites, settings and cached data?')) return;
      clearCache(); store.remove(KEYS.favs); store.remove(KEYS.current); store.remove(KEYS.settings);
      favs = []; current = DEFAULT_LOCATION; settings = { ...DEFAULT_SETTINGS }; zonesCache = null; applyTheme();
      toast('Reset done'); location.hash = '#/';
    });
  }

  /* ---------- start ---------- */
  applyTheme();
  route();
})();
