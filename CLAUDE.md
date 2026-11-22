# muselabs.app: rules for agents

This repo is the Muse Labs website. `site/` is deployed as-is to the Cloudflare Pages project `muselabs` (muselabs.app) by `.github/workflows/deploy.yml`: pull requests get a preview link, a merge to `main` goes live. There's no build step.

- **Change the site through pull requests** (drafts), so Jason sees the preview link before it's live. Never push site changes straight to `main`.
- **Never break an address in `scripts/urls.txt`.** The App Store links to Poof's and Muse Penguin's privacy pages, and AdMob reads `app-ads.txt` for Muse Shelf. Moving a page means adding a redirect in `site/_redirects` and updating `urls.txt`.
- Pages are plain HTML and CSS sharing `site/assets/style.css` (and `labs.css` for the homepage). Keep the house style: the site's own colors and fonts, short plain copy.
- A new page goes in `sitemap.xml` too, unless it's meant to stay unlisted (like `/frogquest/`).
- Never put secrets in the repo. The deploy key lives only in the repository secrets.
