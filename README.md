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

## Muse Feed (muselabs.app/feed): Moo's private feed
A private web app for Moo, on any device (even a work PC where claude.ai is blocked; it can go on a phone's home screen too). Only his GitHub account gets in: GitHub's device sign-in shows a short code that he approves on github.com, and the device then stays signed in for 90 days (renewed as he uses it, up to 180 days; then he signs in again). It's unlisted: not in the sitemap, and never indexed.

- **What's where:** the page is `site/feed/`; its API is `functions/feed/api/`, which hands everything to `feed-api/` (tests in `feed-api/test/`, run by every deploy). The feed itself lives in Moo's private vault (muse-os, `Notes/Muse Feed/`): Claude writes `feed.json` at each check, each thing he sends becomes `replies/<id>.json` and pings Claude (the ⚡ Inbox button task) with that id and nothing else, which answers in that same file, 👍/👎 go to `prefs.json`, and pictures he pastes or Claude adds (to an answer, or to a PR card next to its Merge button) live in `pictures/`, which only the signed-in API hands out, and each sign-in is noted in `signins/<date>.json`. Nothing private is in this repo, and pictures of the feed in PRs use sample data.
- **Its keys (once, about 5 minutes on GitHub):**
    1. **Sign-in app:** [github.com/settings/applications/new](https://github.com/settings/applications/new): name `Muse Feed`, Homepage URL and Authorization callback URL both `https://muselabs.app/feed/` (the callback isn't used), tick **Enable Device Flow**, **Register application**. Copy its **Client ID** (not a secret; no client secret is needed) into this repo's **Settings › Secrets and variables › Actions › Variables** as `FEED_GITHUB_CLIENT_ID`.
    2. **Vault key:** [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new): name `Muse Feed work site` (GitHub refused a name with a slash in it), resource owner jasonmuse, expiration up to a year, **Only select repositories: muse-os**, Repository permissions › **Contents: Read and write**. Generate, save it in Bitwarden, and add it as the repository secret `FEED_GITHUB_TOKEN`.
    3. **Ping key (optional):** the ⚡ Inbox button token from Bitwarden ("Muse OS inbox button") as the repository secret `FEED_FIRE_TOKEN`. Without it, what he sends waits for Claude's next check (4:43am, 12:39pm, 8:39pm).
    4. **Sign-in key (a good idea):** any long random text as the secret `FEED_SESSION_SECRET`. It signs the sign-in cookies. Without it they're signed with a key made from the vault key, so changing the vault key also signs every device out.
    5. **Re-run the last deploy to main** (Actions › Deploy muselabs.app › the newest run on main › Re-run all jobs). A deploy to main copies the keys to Cloudflare (`scripts/feed-keys.sh`, names only in the log).
- **Where the keys go:** to the live site only. A pull request's preview runs that pull request's code, so previews never get the keys (their /feed says "This is a preview"), the keys step only runs for a push to main, and each run takes any `FEED_*` name off Cloudflare's preview side. A push to main runs in a GitHub environment called `production`: give it a "main only" branch rule and keep the `FEED_*` secrets there instead of in the repository secrets, and no pull request's run can read them at all.
- **Its own data repo (optional, safer):** by default the feed's files sit in the vault, so the vault key can read all of muse-os. To give the feed a key that opens nothing but the feed:
    1. Make a private repo for it (say `muse-feed-data`) and have Muse OS move the feed's files there, and write there from then on (`feed.json`, `prefs.json`, `replies/`, `pictures/`, `signins/`, on `main`).
    2. Make a new token like the vault key in step 2 above, but with **Only select repositories:** that one repo. Save it as `FEED_GITHUB_TOKEN`, in place of the old one.
    3. Add two variables (Settings › Secrets and variables › Actions › Variables): `FEED_DATA_REPO` = `jasonmuse/muse-feed-data`, and `FEED_DATA_DIR` = the folder inside it, or `/` when the files sit at the top.
    4. Re-run the last deploy to main, then delete the old vault key on GitHub. To go back, set the two variables to `jasonmuse/muse-os` and `Notes/Muse Feed`.
- **Sign every device out:** set the variable `FEED_SESSION_EPOCH` (Settings › Secrets and variables › Actions › Variables) to anything new, like today's date, and re-run the last deploy to main. Changing `FEED_SESSION_SECRET` does the same.
- **How it stays private:** the vault key only ever lives on Cloudflare's side, in production; the page can only load its own files (a strict Content-Security-Policy in `site/_headers`); the API only accepts JSON from its own page, only GitHub account 146852983 (jasonmuse) can sign in, and the cookie is HttpOnly, Secure and SameSite=Strict. Every sign-in pings Muse OS with the time, the country and the kind of browser (from fixed lists: no address, and nothing in the browser's own words), so a sign-in that wasn't him doesn't go unseen. One sign-in can send 20 things in ten minutes and 200 in a day (60 pictures), so a stolen one can't flood the vault. A card's button (Merge) only shows when its words are a shape the page knows, and it shows those exact words before sending them. The deploy's actions are pinned to exact commits.

- **Opening and new versions:** the page opens at once from the copy saved on the device (`site/feed/sw.js`), also on a weak signal or offline. Each open also asks the server for the page's files, and when they changed the page loads the new ones by itself a moment later, at a quiet moment and in the same place. So a fix is on his devices seconds after he next opens the feed, whatever the browser had kept.

## If something goes wrong
- **A change broke the site:** revert the PR on GitHub (it deploys the old version), or in Cloudflare: Workers & Pages › muselabs › Deployments › an older one › **Rollback**. The last hand-uploaded zip is in that list too.
- **The deploy says the new version isn't live:** Cloudflare may treat a branch other than `main` as the live one. In Cloudflare: Workers & Pages › muselabs › Settings › Builds & deployments (or Branch control) › set the production branch to `main`, then re-run the deploy.
- **"Authentication error":** the key is missing the Cloudflare Pages · Edit permission, or the Account ID is for the other account.

## Where this came from
Copied from the live muselabs.app on Nov 21, 2026 (the last hand-uploaded zip), including the pages nothing links to (`/frogquest/`, `app-ads.txt`, the custom 404 page) and its three redirects (`site/_redirects`). Cloudflare's email protection was undone in the copy; Cloudflare adds it back when it serves the pages.
