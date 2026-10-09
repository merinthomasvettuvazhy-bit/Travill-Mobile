# Travillox AI — BMTC Bus Integration

## Run locally
1. Extract the ZIP into a folder.
2. Open the folder in VS Code.
3. Use the **Live Server** extension and choose **Open with Live Server** on `index.html` (recommended; service workers require localhost/HTTPS).
4. Press **🚌 Bus**, enter a BMTC route number such as `335E`, and check the browser Console (F12) for `[BUS]` logs.

## Files
- `index.html` — app page and Bus button
- `style.css` — original app styling
- `app.js` — original Travillox app behavior
- `bus.js` — BMTC route lookup, route stops and available live-bus markers
- `sw.js` — service worker with a refreshed cache version
- `manifest.json`, `icons/icon.svg` — installable web app metadata/icon

## Important notes
- The bus module calls the staging BMTC API at `https://bmtcmobileapistaging.amnex.com/WebAPI`. It is an unofficial integration and may stop working or change without notice.
- The browser may block direct requests due to CORS or the API may reject request fields. If that happens, the button should still open the route prompt; the console and in-app message will show the request error. A small server-side proxy may be required for CORS.
- Live vehicle markers appear only if the API response includes vehicle data; route/stops availability is controlled by the upstream API.
- Do not put private API keys or credentials in frontend JavaScript.
