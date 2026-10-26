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
  const DEVELOPER = { name: 'Razie Mat Saman', email: 'raziems@msn.com' };

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
  const DEFAULT_SETTINGS = { lang: 'ms', clock: '12', method: 'auto', school: 0, extra: false, theme: 'auto' };
  const DEFAULT_LOCATION = { id: 'jakim:PNG01', kind: 'jakim', zone: 'PNG01', cc: 'my', label: 'Pulau Pinang', sub: 'PNG01 · Pulau Pinang' };

  /* ---------- translations ---------- */
  const STR = {
    ms: {
      nav_: 'Waktu solat', nav_qibla: 'Kiblat', nav_locations: 'Lokasi', nav_settings: 'Tetapan', nav_about: 'Perihal',
      error: 'Ada masalah', loading: 'Memuatkan…',
      loading_times: (l) => `Memuatkan waktu solat untuk ${l}…`,
      times_unavailable: (e) => `Waktu solat tidak tersedia (${e}). Semak sambungan internet dan cuba lagi.`,
      change: 'Tukar', change_location: 'Tukar lokasi',
      fav_add: 'Simpan sebagai kegemaran', fav_remove: 'Buang daripada kegemaran',
      fav_saved: 'Disimpan ke kegemaran', fav_removed: 'Dibuang daripada kegemaran',
      next_prayer: 'Solat seterusnya', tomorrow: 'esok', in_: 'dalam',
      no_times_today: 'Tiada waktu untuk hari ini.',
      tz_note: (tz) => `Waktu mengikut zon masa ${tz}`, source: 'Sumber',
      show_month: 'Papar bulan', hide_month: 'Sembunyi bulan', day: 'Hari',
      badge_my: 'JAKIM', badge_world: 'Seluruh dunia',
      finding_qibla: (l) => `Mencari arah kiblat untuk ${l}…`,
      qibla_failed: (e) => `Arah kiblat tidak dapat ditentukan (${e}).`,
      use_position: '📍 Guna kedudukan saya', my_position: '📍 Kedudukan saya',
      from_north: 'dari utara sebenar', compass_point: 'mata angin', to_kaaba: 'ke Kaabah',
      enable_compass: '🧭 Hidupkan kompas', compass_on: '🧭 Kompas hidup',
      live_hint: 'Pada telefon, dail berpusing mengikut peranti: hadap penanda Kaabah berwarna emas apabila ia berada di atas.',
      no_live: 'Buka halaman ini pada telefon untuk kompas langsung. Penanda emas menunjukkan arah kiblat berbanding utara sebenar.',
      bearing_note: 'Arah dikira dari utara sebenar. Kompas magnet mungkin berbeza beberapa darjah bergantung pada lokasi anda.',
      compass_denied: 'Kebenaran kompas ditolak', facing: '✓ Anda sedang menghadap Kaabah',
      turn: (dir, deg) => `Pusing ke ${dir === 'right' ? 'kanan' : 'kiri'} ${deg}°`,
      no_readings: 'Tiada bacaan kompas lagi. Ini memerlukan telefon dengan magnetometer dan HTTPS.',
      locations: 'Lokasi', current: 'Semasa', current_badge: 'semasa', favourites: 'Kegemaran',
      fav_hint: 'Ketik kegemaran untuk menggunakannya. Tekan bintang pada halaman waktu solat untuk menambah lokasi di sini. Kegemaran disimpan dalam pelayar ini.',
      no_favs: 'Belum ada kegemaran.', rename: 'Namakan semula', move_up: 'Naik ke atas', remove: 'Buang',
      rename_prompt: 'Nama untuk kegemaran ini',
      where: 'Di mana anda?', gps_hint: 'Di Malaysia, zon JAKIM rasmi dipilih mengikut kedudukan anda; di tempat lain pengiraan seluruh dunia digunakan.',
      search_ph: 'Cari bandar atau tempat, cth. Istanbul, Makkah, London', search: 'Cari', searching: 'Mencari…',
      no_places: 'Tiada tempat dijumpai.', search_failed: (e) => `Carian gagal (${e})`, setting_location: 'Menetapkan lokasi…',
      zone_title: 'Malaysia (zon JAKIM)', loading_zones: 'Memuatkan zon…', use_zone: 'Guna zon ini', zones_unavailable: (e) => `Zon tidak tersedia (${e})`,
      getting_position: 'Mendapatkan kedudukan anda…', location_set: (l) => `Lokasi ditetapkan ke ${l}`,
      no_geo: 'Pelayar ini tidak menyokong lokasi', geo_denied: 'Kebenaran lokasi ditolak', geo_failed: 'Kedudukan anda tidak dapat diperoleh',
      no_coords: 'Lokasi tiada koordinat', coords_not_found: (q) => `Koordinat untuk ${q} tidak dijumpai`,
      settings: 'Tetapan', display: 'Paparan', language: 'Bahasa', lang_ms: 'Bahasa Malaysia', lang_en: 'English',
      clock: 'Format masa', clock12: '12 jam (5:45 AM)', clock24: '24 jam (05:45)',
      theme: 'Tema', theme_auto: 'Ikut peranti', theme_light: 'Cerah', theme_dark: 'Gelap',
      extra: 'Papar juga Imsak dan Dhuha',
      world_calc: 'Pengiraan seluruh dunia', world_note: 'Digunakan untuk lokasi di luar Malaysia (Aladhan). Zon Malaysia sentiasa menggunakan waktu rasmi JAKIM.',
      method: 'Kaedah pengiraan', method_auto: 'Automatik (mengikut negara)',
      school: 'Kaedah Asar', school0: 'Piawai (Syafie, Maliki, Hanbali)', school1: 'Hanafi',
      data: 'Data', data_note: 'Waktu solat disimpan dalam pelayar ini selama 12 jam supaya aplikasi masih berfungsi seketika tanpa talian.',
      clear_cache: 'Kosongkan cache waktu', reset: 'Set semula semua', reset_confirm: 'Buang kegemaran, tetapan dan data cache?',
      cache_cleared: 'Cache dikosongkan', reset_done: 'Set semula selesai', saved: 'Disimpan',
      about: 'Perihal', about_title: 'Perihal Solat & Qibla',
      about_intro: 'Waktu solat harian untuk Malaysia (zon JAKIM) dan seluruh dunia, kompas kiblat, dan lokasi kegemaran yang mudah ditukar ketika dalam perjalanan. Semua data disimpan dalam pelayar anda; tiada akaun diperlukan.',
      developer: 'Pembangun', email: 'E-mel', sources: 'Sumber data',
      src_jakim: 'Waktu solat Malaysia: JAKIM e-Solat melalui waktusolat.app',
      src_aladhan: 'Waktu solat seluruh dunia: Aladhan API',
      src_ummah: 'Arah kiblat: UmmahAPI (Aladhan sebagai sandaran)',
      src_osm: 'Carian tempat: OpenStreetMap Nominatim',
      home_tip: 'Tambah halaman ini ke skrin utama telefon untuk akses pantas ketika dalam perjalanan.',
      version: 'Versi',
    },
    en: {
      nav_: 'Prayer times', nav_qibla: 'Qibla', nav_locations: 'Locations', nav_settings: 'Settings', nav_about: 'About',
      error: 'Something went wrong', loading: 'Loading…',
      loading_times: (l) => `Loading prayer times for ${l}…`,
      times_unavailable: (e) => `Prayer times unavailable (${e}). Check your connection and try again.`,
      change: 'Change', change_location: 'Change location',
      fav_add: 'Save as favourite', fav_remove: 'Remove from favourites',
      fav_saved: 'Saved to favourites', fav_removed: 'Removed from favourites',
      next_prayer: 'Next prayer', tomorrow: 'tomorrow', in_: 'in',
      no_times_today: 'No times for today.',
      tz_note: (tz) => `Times shown in ${tz} local time`, source: 'Source',
      show_month: 'Show month', hide_month: 'Hide month', day: 'Day',
      badge_my: 'JAKIM', badge_world: 'Worldwide',
      finding_qibla: (l) => `Finding the qibla for ${l}…`,
      qibla_failed: (e) => `Could not work out the qibla (${e}).`,
      use_position: '📍 Use my current position', my_position: '📍 My position',
      from_north: 'from true north', compass_point: 'compass point', to_kaaba: 'to the Kaaba',
      enable_compass: '🧭 Enable live compass', compass_on: '🧭 Live compass on',
      live_hint: 'On a phone, the dial turns with the device: face the gold Kaaba marker when it is at the top.',
      no_live: 'Open this page on a phone to use the live compass. The gold marker shows the qibla relative to true north.',
      bearing_note: 'Bearing is relative to true north. Magnetic compasses can differ by a few degrees depending on where you are.',
      compass_denied: 'Compass permission was denied', facing: '✓ You are facing the Kaaba',
      turn: (dir, deg) => `Turn ${dir} ${deg}°`,
      no_readings: 'No compass readings yet. This needs a phone with a magnetometer and HTTPS.',
      locations: 'Locations', current: 'Current', current_badge: 'current', favourites: 'Favourites',
      fav_hint: 'Tap a favourite to use it. Star a location on the prayer times page to add it here. Favourites are stored in this browser.',
      no_favs: 'No favourites yet.', rename: 'Rename', move_up: 'Move up', remove: 'Remove',
      rename_prompt: 'Name for this favourite',
      where: 'Where are you?', gps_hint: 'In Malaysia this picks the official JAKIM zone for your position; elsewhere it uses the worldwide calculation.',
      search_ph: 'Search a city or place, e.g. Istanbul, Mecca, London', search: 'Search', searching: 'Searching…',
      no_places: 'No places found.', search_failed: (e) => `Search failed (${e})`, setting_location: 'Setting location…',
      zone_title: 'Malaysia (JAKIM zone)', loading_zones: 'Loading zones…', use_zone: 'Use this zone', zones_unavailable: (e) => `Zones unavailable (${e})`,
      getting_position: 'Getting your position…', location_set: (l) => `Location set to ${l}`,
      no_geo: 'This browser has no location support', geo_denied: 'Location permission was denied', geo_failed: 'Could not get your position',
      no_coords: 'Location has no coordinates', coords_not_found: (q) => `Could not find coordinates for ${q}`,
      settings: 'Settings', display: 'Display', language: 'Language', lang_ms: 'Bahasa Malaysia', lang_en: 'English',
      clock: 'Time format', clock12: '12-hour (5:45 AM)', clock24: '24-hour (05:45)',
      theme: 'Theme', theme_auto: 'Follow device', theme_light: 'Light', theme_dark: 'Dark',
      extra: 'Also show Imsak and Dhuha',
      world_calc: 'Worldwide calculation', world_note: 'Used for locations outside Malaysia (Aladhan). Malaysian zones always use the official JAKIM times.',
      method: 'Calculation method', method_auto: 'Automatic (by country)',
      school: 'Asr juristic method', school0: "Standard (Shafi'i, Maliki, Hanbali)", school1: 'Hanafi',
      data: 'Data', data_note: 'Prayer times are cached in this browser for 12 hours so the app also works briefly offline.',
      clear_cache: 'Clear cached times', reset: 'Reset everything', reset_confirm: 'Remove favourites, settings and cached data?',
      cache_cleared: 'Cache cleared', reset_done: 'Reset done', saved: 'Saved',
      about: 'About', about_title: 'About Solat & Qibla',
      about_intro: 'Daily prayer times for Malaysia (JAKIM zones) and worldwide, a qibla compass, and favourite locations that are easy to switch while travelling. Everything is stored in your browser; no account needed.',
      developer: 'Developer', email: 'Email', sources: 'Data sources',
      src_jakim: 'Malaysia prayer times: JAKIM e-Solat via waktusolat.app',
      src_aladhan: 'Worldwide prayer times: Aladhan API',
      src_ummah: 'Qibla direction: UmmahAPI (Aladhan as fallback)',
      src_osm: 'Place search: OpenStreetMap Nominatim',
      home_tip: 'Add this page to your phone\'s home screen for quick access when travelling.',
      version: 'Version',
    },
  };
  const t = (key, ...args) => {
    const table = STR[settings.lang] || STR.ms;
    const v = table[key] ?? STR.en[key] ?? key;
    return typeof v === 'function' ? v(...args) : v;
  };

  /* ---------- state ---------- */
  const stored = store.get(KEYS.settings, {});
  if (!stored.lang && stored.names) stored.lang = stored.names; // older versions had a "prayer names" setting
  let settings = { ...DEFAULT_SETTINGS, ...stored };
  let favs = store.get(KEYS.favs, []);
  let current = store.get(KEYS.current, null) || DEFAULT_LOCATION;
  let zonesCache = null;
  let tickTimer;
  let orientationHandler;

  function saveSettings() { store.set(KEYS.settings, settings); applyTheme(); applyLang(); }
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
    if (isFav(loc)) { favs = favs.filter((f) => f.id !== loc.id); toast(t('fav_removed')); }
    else { favs.push({ ...loc }); toast(t('fav_saved')); }
    saveFavs();
  }
  function applyTheme() {
    if (settings.theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', settings.theme);
  }
  function applyLang() {
    document.documentElement.lang = settings.lang;
    $$('#nav a').forEach((a) => { a.textContent = t('nav_' + a.dataset.route); });
    const fa = $('#footAbout'); if (fa) fa.textContent = t('about');
  }

  /* ---------- fetch + cache ---------- */
  async function fetchJson(url, opts) {
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
  const dateLocale = () => (settings.lang === 'ms' ? 'ms-MY' : 'en-GB');
  const dateKey = (ms, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  const ymd = (key) => key.split('-').map(Number);
  function addDays(key, n) { const [y, m, d] = ymd(key); const dt = new Date(Date.UTC(y, m - 1, d + n)); return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`; }
  const fmtTime = (ms, tz) => new Date(ms).toLocaleTimeString(settings.clock === '12' ? 'en-US' : 'en-GB', { hour: '2-digit', minute: '2-digit', hour12: settings.clock === '12', timeZone: tz });
  const fmtDate = (ms, tz) => new Date(ms).toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: tz });
  const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const names = () => NAMES[settings.lang] || NAMES.ms;
  function hijriLabel(h) {
    if (!h) return '';
    const months = HIJRI_MONTHS[settings.lang] || HIJRI_MONTHS.ms;
    return `${h.d} ${months[h.m - 1] || h.m} ${h.y}H`;
  }
  function countdown(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const hu = settings.lang === 'ms' ? 'j' : 'h';
    return h ? `${h}${hu} ${pad(m)}m ${pad(sec)}s` : `${m}m ${pad(sec)}s`;
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
      for (const [k, v] of Object.entries(map)) { const tm = Date.parse(d.timings[k]); if (!Number.isNaN(tm)) times[v] = tm; }
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
    const label = a.city || a.town || a.village || a.municipality || a.county || a.state_district || a.state || fallback || '?';
    const sub = [a.state && a.state !== label ? a.state : null, a.country].filter(Boolean).join(', ');
    return { label, sub };
  }
  async function reverseGeocode(lat, lon) {
    try {
      const r = await fetchJson(`${NOMINATIM}/reverse?lat=${lat}&lon=${lon}&format=jsonv2&zoom=10&accept-language=${settings.lang}`);
      return { ...labelFromAddress(r.address || {}, r.name), cc: r.address?.country_code || '' };
    } catch {
      return { label: `${lat.toFixed(3)}, ${lon.toFixed(3)}`, sub: 'GPS', cc: '' };
    }
  }
  async function searchPlaces(q) {
    const r = await fetchJson(`${NOMINATIM}/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=8&addressdetails=1&accept-language=${settings.lang}`);
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
      if (!navigator.geolocation) return reject(new Error(t('no_geo')));
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        (err) => reject(new Error(err.code === 1 ? t('geo_denied') : t('geo_failed'))),
        { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
      );
    });
  }
  /* Coordinates for the qibla page: zone-only locations get geocoded from the district name once. */
  async function ensureCoords(loc) {
    if (typeof loc.lat === 'number' && typeof loc.lon === 'number') return loc;
    if (loc.kind !== 'jakim') throw new Error(t('no_coords'));
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
    if (!hit) throw new Error(t('coords_not_found', candidates[0]));
    const updated = { ...loc, lat: Number(hit.lat), lon: Number(hit.lon), cc: 'my' };
    if (current.id === loc.id) setCurrent(updated);
    return updated;
  }
  const kindBadge = (loc) => (loc.kind === 'jakim' ? `<span class="badge my">${t('badge_my')}</span>` : `<span class="badge world">${t('badge_world')}</span>`);

  /* ---------- router ---------- */
  function route() {
    const path = location.hash.replace(/^#\/?/, '').split('?')[0];
    $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === path));
    clearInterval(tickTimer);
    if (orientationHandler) { window.removeEventListener('deviceorientationabsolute', orientationHandler); window.removeEventListener('deviceorientation', orientationHandler); orientationHandler = null; }
    const pages = { '': renderPrayer, qibla: renderQibla, locations: renderLocations, settings: renderSettings, about: renderAbout };
    (pages[path] || renderPrayer)().catch((e) => { app.innerHTML = `<div class="card"><div class="empty">${t('error')}: ${esc(e.message)}</div></div>`; });
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
    app.innerHTML = `${chipsHtml()}<div class="card" id="prayer"><p class="muted">${esc(t('loading_times', current.label))}</p></div><div id="month"></div>`;
    bindChips(app, renderPrayer);
    let data;
    try {
      data = await loadTimes(current);
    } catch (e) {
      $('#prayer').innerHTML = `<div class="loc-head"><div><div class="loc-name">${esc(current.label)}</div><div class="loc-sub">${esc(current.sub || '')}</div></div><span class="spacer"></span><a class="btn sm" href="#/locations">${t('change_location')}</a></div><div class="empty">${esc(t('times_unavailable', e.message))}</div>`;
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
        const c = $('#nextCount'); if (c && next) c.textContent = `${t('in_')} ${countdown(next.at - now)}`;
        return;
      }
      lastNextKey = nextKey;
      const times = today ? list.filter((k) => today.times[k]).map((k) => {
        const tm = today.times[k];
        const cls = next && nextDay === 'today' && next.key === k ? 'next' : tm <= now ? 'past' : '';
        return `<div class="ptime ${cls} ${MAIN.includes(k) ? '' : 'minor'}"><b>${esc(N[k])}</b>${fmtTime(tm, data.tz)}</div>`;
      }).join('') : `<div class="empty">${t('no_times_today')}</div>`;
      const tzNote = data.tz !== deviceTz ? `<span class="tz-note">${esc(t('tz_note', data.tz))}</span>` : '';
      box.innerHTML = `
        <div class="loc-head">
          <div><div class="loc-name">${esc(current.label)}</div><div class="loc-sub">${esc(current.sub || '')} ${kindBadge(current)}</div></div>
          <span class="spacer"></span>
          <button class="btn icon star ${isFav(current) ? 'on' : ''}" data-act="fav" title="${isFav(current) ? t('fav_remove') : t('fav_add')}">${isFav(current) ? '★' : '☆'}</button>
          <a class="btn sm" href="#/locations">${t('change')}</a>
        </div>
        ${next ? `<div class="next-box">
          <div><div class="n-label">${t('next_prayer')} ${nextDay === 'tomorrow' ? `· ${t('tomorrow')}` : ''}</div><div class="n-name">${esc(N[next.key])}</div></div>
          <div class="n-time">${fmtTime(next.at, data.tz)}</div>
          <span class="spacer"></span>
          <div class="n-count" id="nextCount">${t('in_')} ${countdown(next.at - now)}</div>
        </div>` : ''}
        <div class="prayer-times ${settings.extra ? 'extra' : ''}">${times}</div>
        <div class="date-line">
          <span>${esc(fmtDate(now, data.tz))}</span>
          ${today?.hijri ? `<span>${esc(hijriLabel(today.hijri))}</span>` : ''}
          ${tzNote}
          <span class="muted">${t('source')}: ${esc(data.source)}</span>
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
    const title = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const rows = days.map((d) => {
      const dt = new Date(Date.UTC(...ymd(d.date).map((v, i) => (i === 1 ? v - 1 : v))));
      const wd = dt.toLocaleDateString(dateLocale(), { weekday: 'short', timeZone: 'UTC' });
      const cls = [d.date === data.today ? 'today' : '', dt.getUTCDay() === 5 ? 'friday' : ''].join(' ');
      return `<tr class="${cls}"><td>${esc(wd)} ${Number(d.date.slice(-2))}</td>${list.map((k) => `<td>${d.times[k] ? fmtTime(d.times[k], data.tz) : '—'}</td>`).join('')}</tr>`;
    }).join('');
    $('#month').innerHTML = `
      <div class="card">
        <div class="card-head"><h2>${esc(title)}</h2><button class="btn sm" id="toggleMonth">${t('show_month')}</button></div>
        <div class="table-wrap" id="monthTable" hidden><table class="month"><thead><tr><th>${t('day')}</th>${list.map((k) => `<th>${esc(N[k])}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
      </div>`;
    $('#toggleMonth').addEventListener('click', (ev) => {
      const tb = $('#monthTable'); tb.hidden = !tb.hidden; ev.target.textContent = tb.hidden ? t('show_month') : t('hide_month');
      if (!tb.hidden) $('tr.today', tb)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }

  /* ---------- page: qibla ---------- */
  async function renderQibla() {
    app.innerHTML = `${chipsHtml()}<div class="card" id="qibla"><p class="muted">${esc(t('finding_qibla', current.label))}</p></div>`;
    bindChips(app, renderQibla);
    let loc, q;
    try {
      loc = await ensureCoords(current);
      q = await getQibla(loc.lat, loc.lon);
    } catch (e) {
      $('#qibla').innerHTML = `
        <div class="loc-head"><div><div class="loc-name">${esc(current.label)}</div><div class="loc-sub">${esc(current.sub || '')}</div></div><span class="spacer"></span><a class="btn sm" href="#/locations">${t('change')}</a></div>
        <div class="empty">${esc(t('qibla_failed', e.message))}</div>
        <p style="text-align:center"><button class="btn primary" id="gpsBtn">${t('use_position')}</button></p>`;
      $('#gpsBtn').addEventListener('click', () => useGps(renderQibla));
      return;
    }
    const bearing = q.direction;
    const canLive = 'DeviceOrientationEvent' in window;
    $('#qibla').innerHTML = `
      <div class="loc-head">
        <div><div class="loc-name">${esc(loc.label)}</div><div class="loc-sub">${esc(loc.sub || '')} · ${loc.lat.toFixed(4)}, ${loc.lon.toFixed(4)}</div></div>
        <span class="spacer"></span>
        <button class="btn sm" id="gpsBtn">${t('my_position')}</button>
        <a class="btn sm" href="#/locations">${t('change')}</a>
      </div>
      <div class="qibla-wrap">
        ${compassSvg(bearing)}
        <div class="qibla-stats">
          <div class="stat"><div class="n">${bearing.toFixed(1)}°</div><div class="l">${t('from_north')}</div></div>
          <div class="stat"><div class="n">${esc(q.compass || toCompass(bearing))}</div><div class="l">${t('compass_point')}</div></div>
          <div class="stat"><div class="n">${q.distanceKm ? Math.round(q.distanceKm).toLocaleString() + ' km' : '—'}</div><div class="l">${t('to_kaaba')}</div></div>
        </div>
        ${canLive ? `<button class="btn primary" id="liveBtn">${t('enable_compass')}</button><p class="small muted" id="liveNote">${t('live_hint')}</p>` : `<p class="small muted">${t('no_live')}</p>`}
        <p class="small muted">${t('bearing_note')}</p>
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
    const labels = [['N', 150, 58, 'n'], ['E', 242, 155, ''], ['S', 150, 252, ''], ['W', 58, 155, '']].map(([tx, x, y, c]) => `<text class="${c}" x="${x}" y="${y}" text-anchor="middle">${tx}</text>`).join('');
    return `
      <svg class="compass" viewBox="0 0 300 300" role="img" aria-label="${bearing.toFixed(1)}°">
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
        if (p !== 'granted') throw new Error(t('compass_denied'));
      }
    } catch (e) { toast(e.message, true); return; }
    let got = false, aligned = false;
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
      // small hysteresis so the colour does not flicker right at the edge
      aligned = Math.abs(diff) < (aligned ? 7 : 5);
      $('#qibla')?.classList.toggle('aligned', aligned);
      $('.compass')?.classList.toggle('aligned', aligned);
      if (note) note.innerHTML = aligned ? `<span class="live-on">${t('facing')}</span>` : esc(t('turn', diff > 0 ? 'right' : 'left', Math.abs(Math.round(diff))));
    };
    if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', orientationHandler);
    else window.addEventListener('deviceorientation', orientationHandler);
    btn.disabled = true; btn.textContent = t('compass_on');
    setTimeout(() => { if (!got && note) note.textContent = t('no_readings'); }, 3000);
  }

  /* ---------- page: locations ---------- */
  async function useGps(after) {
    toast(t('getting_position'));
    try {
      const { lat, lon } = await getGps();
      const loc = await locationFromCoords(lat, lon);
      setCurrent(loc);
      toast(t('location_set', loc.label));
      after();
    } catch (e) { toast(e.message, true); }
  }

  async function renderLocations() {
    app.innerHTML = `
      <div class="page-head"><h1>${t('locations')}</h1><span class="spacer"></span><span class="small muted">${t('current')}: <strong>${esc(current.label)}</strong> ${kindBadge(current)}</span></div>
      <div class="grid cols-2">
        <div class="card">
          <div class="card-head"><h2>${t('favourites')}</h2></div>
          <div id="favList"></div>
          <p class="small muted" style="margin-top:.75rem">${t('fav_hint')}</p>
        </div>
        <div>
          <div class="card">
            <div class="card-head"><h2>${t('where')}</h2></div>
            <p><button class="btn primary" id="gpsBtn">${t('use_position')}</button></p>
            <p class="small muted">${t('gps_hint')}</p>
            <form id="searchForm" class="inline-form" style="margin-top:1rem">
              <input id="searchInput" placeholder="${esc(t('search_ph'))}" required autocomplete="off">
              <button class="btn">${t('search')}</button>
            </form>
            <ul class="results" id="results" hidden></ul>
          </div>
          <div class="card">
            <div class="card-head"><h2>${t('zone_title')}</h2></div>
            <select id="zoneSelect"><option>${t('loading_zones')}</option></select>
            <p style="margin-top:.75rem"><button class="btn" id="zoneBtn">${t('use_zone')}</button></p>
          </div>
        </div>
      </div>`;
    drawFavList();
    $('#gpsBtn').addEventListener('click', () => useGps(() => { location.hash = '#/'; }));
    $('#searchForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const q = $('#searchInput').value.trim();
      const ul = $('#results');
      ul.hidden = false; ul.innerHTML = `<li class="muted">${t('searching')}</li>`;
      try {
        const results = await searchPlaces(q);
        if (!results.length) { ul.innerHTML = `<li class="muted">${t('no_places')}</li>`; return; }
        ul.innerHTML = results.map((r, i) => `<li data-i="${i}"><strong>${esc(r.label)}</strong><span class="small muted">${esc(r.display)}</span></li>`).join('');
        $$('li', ul).forEach((li) => li.addEventListener('click', async () => {
          const r = results[Number(li.dataset.i)];
          toast(t('setting_location'));
          const loc = r.cc === 'my' ? await locationFromCoords(r.lat, r.lon) : { id: locId({ kind: 'geo', lat: r.lat, lon: r.lon }), kind: 'geo', lat: r.lat, lon: r.lon, cc: r.cc, label: r.label, sub: r.sub };
          if (r.cc === 'my') loc.label = r.label;
          setCurrent(loc);
          location.hash = '#/';
        }));
      } catch (e) { ul.innerHTML = `<li class="muted">${esc(t('search_failed', e.message))}</li>`; }
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
    } catch (e) { const sel = $('#zoneSelect'); if (sel) sel.innerHTML = `<option>${esc(t('zones_unavailable', e.message))}</option>`; }
  }
  function drawFavList() {
    const box = $('#favList');
    if (!favs.length) { box.innerHTML = `<div class="empty">${t('no_favs')}</div>`; return; }
    box.innerHTML = `<ul class="list">${favs.map((f) => `
      <li class="clickable" data-id="${esc(f.id)}">
        <div class="body" data-act="use"><div class="title">${esc(f.label)} ${f.id === current.id ? `<span class="badge current">${t('current_badge')}</span>` : ''}</div><div class="meta">${kindBadge(f)}<span>${esc(f.sub || '')}</span></div></div>
        <div class="actions">
          <button class="btn sm icon" data-act="rename" title="${t('rename')}">✎</button>
          <button class="btn sm icon" data-act="up" title="${t('move_up')}">↑</button>
          <button class="btn sm icon danger" data-act="remove" title="${t('remove')}">✕</button>
        </div>
      </li>`).join('')}</ul>`;
    $$('li', box).forEach((li) => {
      const id = li.dataset.id;
      const idx = () => favs.findIndex((f) => f.id === id);
      $('[data-act="use"]', li).addEventListener('click', () => { setCurrent(favs[idx()]); location.hash = '#/'; });
      $('[data-act="rename"]', li).addEventListener('click', () => {
        const f = favs[idx()];
        const name = prompt(t('rename_prompt'), f.label);
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
      <div class="page-head"><h1>${t('settings')}</h1></div>
      <div class="grid cols-2">
        <div class="card">
          <div class="card-head"><h2>${t('display')}</h2></div>
          <label>${t('language')}
            <select data-setting="lang"><option value="ms">${t('lang_ms')}</option><option value="en">${t('lang_en')}</option></select></label>
          <label>${t('clock')}
            <select data-setting="clock"><option value="12">${t('clock12')}</option><option value="24">${t('clock24')}</option></select></label>
          <label>${t('theme')}
            <select data-setting="theme"><option value="auto">${t('theme_auto')}</option><option value="light">${t('theme_light')}</option><option value="dark">${t('theme_dark')}</option></select></label>
          <label class="check"><input type="checkbox" data-setting="extra"> ${t('extra')}</label>
        </div>
        <div class="card">
          <div class="card-head"><h2>${t('world_calc')}</h2></div>
          <p class="small muted">${t('world_note')}</p>
          <label>${t('method')}
            <select data-setting="method"><option value="auto">${t('method_auto')}</option>${METHODS.map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join('')}</select></label>
          <label>${t('school')}
            <select data-setting="school"><option value="0">${esc(t('school0'))}</option><option value="1">${t('school1')}</option></select></label>
        </div>
        <div class="card">
          <div class="card-head"><h2>${t('data')}</h2></div>
          <p class="small muted">${t('data_note')}</p>
          <button class="btn" id="clearCache">${t('clear_cache')}</button>
          <button class="btn danger" id="resetAll">${t('reset')}</button>
        </div>
      </div>`;
    $$('[data-setting]').forEach((el) => {
      const k = el.dataset.setting;
      if (el.type === 'checkbox') el.checked = Boolean(settings[k]); else el.value = String(settings[k]);
      el.addEventListener('change', () => {
        settings[k] = el.type === 'checkbox' ? el.checked : el.value;
        saveSettings();
        toast(t('saved'));
        if (k === 'lang') renderSettings(); // redraw the page in the new language
      });
    });
    $('#clearCache').addEventListener('click', () => { clearCache(); zonesCache = null; toast(t('cache_cleared')); });
    $('#resetAll').addEventListener('click', () => {
      if (!confirm(t('reset_confirm'))) return;
      clearCache(); store.remove(KEYS.favs); store.remove(KEYS.current); store.remove(KEYS.settings);
      favs = []; current = DEFAULT_LOCATION; settings = { ...DEFAULT_SETTINGS }; zonesCache = null; applyTheme(); applyLang();
      toast(t('reset_done')); location.hash = '#/';
    });
  }

  /* ---------- page: about ---------- */
  async function renderAbout() {
    app.innerHTML = `
      <div class="page-head"><h1>${t('about_title')}</h1></div>
      <div class="grid cols-2">
        <div class="card">
          <p>${t('about_intro')}</p>
          <p class="small muted">${t('home_tip')}</p>
        </div>
        <div class="card">
          <div class="card-head"><h2>${t('developer')}</h2></div>
          <ul class="list">
            <li><div class="body"><div class="title">${esc(DEVELOPER.name)}</div><div class="meta"><span>${t('developer')}</span></div></div></li>
            <li><div class="body"><div class="title"><a href="mailto:${esc(DEVELOPER.email)}">${esc(DEVELOPER.email)}</a></div><div class="meta"><span>${t('email')}</span></div></div></li>
          </ul>
        </div>
        <div class="card">
          <div class="card-head"><h2>${t('sources')}</h2></div>
          <ul class="list">
            <li><div class="body"><div class="title">${t('src_jakim')}</div><div class="meta"><a href="https://www.e-solat.gov.my/" target="_blank" rel="noopener">e-solat.gov.my</a><a href="https://api.waktusolat.app/" target="_blank" rel="noopener">api.waktusolat.app</a></div></div></li>
            <li><div class="body"><div class="title">${t('src_aladhan')}</div><div class="meta"><a href="https://aladhan.com/prayer-times-api" target="_blank" rel="noopener">aladhan.com</a></div></div></li>
            <li><div class="body"><div class="title">${t('src_ummah')}</div><div class="meta"><a href="https://ummahapi.com/qibla-api" target="_blank" rel="noopener">ummahapi.com</a></div></div></li>
            <li><div class="body"><div class="title">${t('src_osm')}</div><div class="meta"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">openstreetmap.org</a></div></div></li>
          </ul>
        </div>
      </div>`;
  }

  /* ---------- start ---------- */
  applyTheme();
  applyLang();
  route();
})();
