# Solat & Qibla

Prayer times and a qibla compass, built for free static hosting at InfinityFree.

Live site: https://solat.site.je/

- **Prayer times** – the same widget as TeamBoard, grown into a page: next prayer with a live countdown,
  today's six times, Hijri date, and a collapsible monthly table.
- **Malaysia** – official JAKIM e-Solat times by zone (PNG01, WLY01, …), via [waktusolat.app](https://api.waktusolat.app/).
- **Worldwide** – any place on earth via the [Aladhan API](https://aladhan.com/prayer-times-api), with 20+ calculation
  methods. The method is picked automatically from the country (JAKIM for Malaysia, MUIS for Singapore, Diyanet for
  Turkey, Umm Al-Qura for Saudi Arabia, …) and can be overridden in Settings. Times are shown in the location's own
  time zone, with a note when that differs from the device.
- **Qibla** – bearing, compass point and distance to the Kaaba from [UmmahAPI](https://ummahapi.com/qibla-api)
  (Aladhan as fallback), drawn on a compass. On a phone, *Enable live compass* turns the dial with the device and
  tells you how far to turn.
- **Locations & favourites** – use GPS (Malaysian coordinates are mapped to their JAKIM zone automatically), search
  any city (OpenStreetMap Nominatim), or pick a JAKIM zone. Star a location to keep it; favourites appear as one-tap
  chips at the top of every page, handy when travelling.
- **Bahasa Malaysia / English** – the whole interface, prayer names, Hijri months and dates switch language.
  Bahasa Malaysia is the default.
- **Settings** – language, 12/24-hour clock, light/dark theme, calculation method, Asr school, optional Imsak and
  Dhuha.
- **About** – developer contact and data-source credits.

Everything is stored in the browser (`localStorage`); there is no backend and no account.

- **Works offline** – a service worker (`public/sw.js`) caches the app shell, and prayer times / qibla answers are
  kept in `localStorage` (12 hours, served stale when the network is down), so the page opens and shows the current
  month even with no connection. Installable on the home screen with proper PNG icons (iOS needs PNG, not SVG).
- **"Are you in …?"** – when the browser already has location permission, the prayer-times page quietly checks GPS on
  load and offers a one-tap switch if you are more than 50 km from the current location (or in a different JAKIM
  zone). It never prompts for permission by itself; use "Gunakan kedudukan saya" once and it works from then on.
  Can be turned off in Settings.

- **Install banner** – on iPhone/iPad Safari a dismissable bar explains Share → "Add to Home Screen" (iOS has no
  install API); on Chrome/Android (and desktop Chrome/Edge) the bar offers a one-tap "Install app" button via
  `beforeinstallprompt`. Hidden once the app runs standalone; step-by-step instructions live on the About page.

**Releasing:** bump the `?v=` numbers in `public/index.html` *and* `VERSION` + the asset URLs in `public/sw.js`
together, otherwise installed copies keep the old files.

## Why Aladhan and not IslamicAPI?

The request was to check whether [islamicapi.com](https://islamicapi.com/doc/prayer-time/) is a better fit for
worldwide times. It is not, for a static site:

| | IslamicAPI | Aladhan |
|---|---|---|
| API key | **Required** (returns `401` without one); the key would be visible in the page source | None |
| Pricing / limits | Pricing page returns 404; limits undocumented | Free, no sign-up; asks only that you cache responses |
| Coverage | Coordinates only, 13 methods | Coordinates, city or address; 23 methods incl. JAKIM, MUIS, Kemenag |
| Monthly data | Yes | Yes (`/calendar`), with ISO-8601 timestamps and the location's time zone |
| Qibla | Included in each response | Separate endpoint |
| CORS | Yes | Yes |

Both return very similar data (they share the same calculation lineage). If a key-based service is wanted later,
`getMonth()` in `public/assets/app.js` is the single place to swap.

## Project layout

```
public/                        ← everything in here is uploaded to htdocs/
  index.html                   page shell
  assets/app.js                the whole front end (vanilla JS, hash router)
  assets/style.css             styles, light/dark (same token system as TeamBoard)
  manifest.webmanifest, icon.svg   add-to-home-screen support
scripts/serve.js               tiny static server for local development
scripts/set-github-secrets.ps1 creates the FTP secrets on the GitHub repo
.github/workflows/deploy.yml   FTP deploy to InfinityFree on push to main
```

## Run locally

```bash
node scripts/serve.js
```

Then open http://localhost:5173/. No dependencies, no build step.

## Deploy to InfinityFree (solat.site.je)

The GitHub Action uploads `public/` over FTP on every push to `main`. The site lives on the same hosting
account as TeamBoard (`raziems.site.je`), so `solat.site.je` is an add-on domain there and its files go to
`/solat.site.je/htdocs/`, never to the account's root `/htdocs/`.

1. In the InfinityFree client area open the hosting account that serves `solat.site.je` → **FTP Details**.
   Note the FTP username (`if0_XXXXXXXX`) and the hosting account password.
2. Add them as GitHub Actions secrets (`FTP_USERNAME`, `FTP_PASSWORD`), either in
   *Settings → Secrets and variables → Actions* or with:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\set-github-secrets.ps1 -FtpUsername if0_XXXXXXXX
   ```
   (the script prompts for the password and never prints it).
3. Add an Actions *variable* `FTP_SERVER_DIR` = `/solat.site.je/htdocs/` (already set on this repo). Leave it
   unset only if the site ever becomes the account's main domain.
4. Push to `main` (or run the workflow manually from the Actions tab).

To move the site to another domain later: add the domain to the hosting account in the InfinityFree control panel,
change `FTP_SERVER_DIR` to `/<new-domain>/htdocs/`, and re-run the workflow.

## Data sources

- JAKIM e-Solat via [api.waktusolat.app](https://api.waktusolat.app/) – zones and monthly times for Malaysia.
- [Aladhan](https://aladhan.com/prayer-times-api) – worldwide monthly times, qibla fallback.
- [UmmahAPI](https://ummahapi.com/qibla-api) – qibla direction and distance.
- [Nominatim](https://nominatim.org/) (OpenStreetMap) – place search and reverse geocoding.
