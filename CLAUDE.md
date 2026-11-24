# muselabs.app: rules for agents

This repo is the Muse Labs website. `site/` is deployed as-is to the Cloudflare Pages project `muselabs` (muselabs.app) by `.github/workflows/deploy.yml`: pull requests get a preview link, a merge to `main` goes live. There's no build step.

- **Change the site through pull requests** (drafts), so Jason sees the preview link before it's live. Never push site changes straight to `main`.
- **Never break an address in `scripts/urls.txt`.** The App Store links to Poof's and Muse Penguin's privacy pages, and AdMob reads `app-ads.txt` for Muse Shelf. Moving a page means adding a redirect in `site/_redirects` and updating `urls.txt`.
- Pages are plain HTML and CSS. The homepage uses `site/assets/home.css` (its fonts are in `assets/fonts/`, its pictures in `assets/shelf/`, `assets/penguin/` and `assets/work/`); the other pages share `site/assets/style.css`. `labs.css` is the old homepage's style, kept so its address still works. Keep the house style: the site's own colors and fonts, short plain copy.
- A new page goes in `sitemap.xml` too, unless it's meant to stay unlisted (like `/frogquest/`).
- Never put secrets in the repo. The deploy key lives only in the repository secrets.
- `site/feed/` is **Muse Feed**, Moo's private feed: unlisted (keep it out of `sitemap.xml`), behind a GitHub sign-in. Its API is Pages Functions (`functions/feed/api/` → `feed-api/`, tests: `node --test feed-api/test/*.test.mjs`, run by every deploy). Its data stays in his private vault; never copy anything from it into this public repo, and use sample data in PR pictures. README › Muse Feed has its keys.
