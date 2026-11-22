# muselabs.app

The Muse Labs website. Everything in `site/` is the site, file for file.

**It deploys itself.** Merge a change into `main` and muselabs.app updates about a minute later. A pull request first gets its own preview link, posted on the PR, so you can see a change before it's live. Every deploy then checks that the pages people and app stores rely on still work (the list is in `scripts/urls.txt`), and goes red if one doesn't.

No more zips: this replaces uploading the site to Cloudflare by hand. The repo is public on purpose: GitHub Actions minutes are free for public repos, and the site is public anyway.

## Changing the site
Ask Claude, or edit a file under `site/` on GitHub. Either way it becomes a pull request with a preview link. Merge it when it looks right.

## Turn on automatic deploys (once, about 5 minutes)
1. **Make a Cloudflare key.** On dash.cloudflare.com: your profile icon › **My Profile** › **API Tokens** › **Create Token** › **Create Custom Token** › Get started.
    - Name: `Muse sites deploy`
    - Permissions: **Account** · **Cloudflare Pages** · **Edit**
    - Account Resources: Include · All accounts (or the one with muselabs)
    - **Continue to summary** › **Create Token**, then **Copy** it. Cloudflare shows it only once, so keep a copy somewhere safe.
2. **Find your Account ID.** On dash.cloudflare.com, open **Workers & Pages** and check that **muselabs** is in the list. The Account ID is the long code in the address bar right after `dash.cloudflare.com/` (it's also on the right side of that page).
3. **Give both to GitHub.** In this repo: **Settings** › **Secrets and variables** › **Actions** › **New repository secret**, twice:
    - `CLOUDFLARE_API_TOKEN`: the key from step 1
    - `CLOUDFLARE_ACCOUNT_ID`: the code from step 2
4. Tell Claude "done". It runs the first deploy and checks muselabs.app.

The same key can deploy your other Cloudflare Pages sites too (like the portfolio copy at jasonmuse.pages.dev): it's the same two secrets in that site's repo.

## If something goes wrong
- **A change broke the site:** revert the PR on GitHub (it deploys the old version), or in Cloudflare: Workers & Pages › muselabs › Deployments › an older one › **Rollback**. The last hand-uploaded zip is in that list too.
- **The deploy says the new version isn't live:** Cloudflare may treat a branch other than `main` as the live one. In Cloudflare: Workers & Pages › muselabs › Settings › Builds & deployments (or Branch control) › set the production branch to `main`, then re-run the deploy.
- **"Authentication error":** the key is missing the Cloudflare Pages · Edit permission, or the Account ID is for the other account.

## Where this came from
Copied from the live muselabs.app on Nov 21, 2026 (the last hand-uploaded zip), including the pages nothing links to (`/frogquest/`, `app-ads.txt`, the custom 404 page) and its three redirects (`site/_redirects`). Cloudflare's email protection was undone in the copy; Cloudflare adds it back when it serves the pages.
