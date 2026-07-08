# Deploying the Tuner (static PWA)

The app is a fully static site — everything lives in **`web/`** and uses relative
paths, so it deploys anywhere with **HTTPS** (required for microphone access) and
needs no build step. Deploy the **`web/` folder** (its `index.html` must be at the
site root).

## Option A — Netlify Drop (fastest, no account needed to start)

1. Go to **https://app.netlify.com/drop**
2. Drag the **`web`** folder onto the page (⚠️ the `web` folder itself, not the
   whole `Tuner` project — `index.html` must be at the top level).
3. You get an instant `https://<random-name>.netlify.app` URL.
4. (Optional) Sign in to claim the site so the URL sticks, and rename it.
5. Open the URL on your phone → **Add to Home Screen**.

To update later: drag the `web` folder onto the site's "Deploys" page again.

## Option B — GitHub Pages (if you use git)

1. `git init` in the project, commit, push to a GitHub repo.
2. Repo **Settings → Pages** → Source: *Deploy from a branch* → pick your branch,
   folder **`/web`** (or move `web/`'s contents to `/docs` and pick `/docs`).
3. Your site: `https://<user>.github.io/<repo>/` — relative paths handle the
   subpath automatically.

## Option C — Cloudflare Pages / Vercel

Connect the repo (or drag-drop). Set the **output/root directory to `web`** and
**no build command** (it's already static).

## Add to Home Screen

- **iPhone (Safari):** Share → *Add to Home Screen*. Launches full-screen with the
  dial icon. (Use it in Safari itself if an installed-PWA mic prompt ever misfires
  on older iOS.)
- **Android (Chrome):** ⋮ → *Install app* / *Add to Home screen*.

## Notes

- **HTTPS is mandatory** for `getUserMedia` (the mic). `localhost` is the only
  http exception — that's why the local `node serve.mjs` works but a LAN IP won't.
- Fonts load from Google Fonts (first load needs network; falls back to system
  fonts offline). Everything else is cached by the service worker for offline use.
- `serve.mjs` at the project root is only for local desktop testing; it is **not**
  part of the deploy.
