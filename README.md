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
A private web app for Moo, on any device (even a work PC where claude.ai is blocked; it can go on a phone's home screen too). Only his GitHub account gets in: GitHub's device sign-in shows a short code that he approves on github.com, and the device then stays signed in for 90 days (renewed as he uses it). It's unlisted: not in the sitemap, and never indexed.

- **What's where:** the page is `site/feed/`; its API is `functions/feed/api/`, which hands everything to `feed-api/` (tests in `feed-api/test/`, run by every deploy). The feed itself lives in Moo's private vault (muse-os, `Notes/Muse Feed/`): Claude writes `feed.json` at each check, each thing he sends becomes `replies/<id>.json` and pings Claude (the ⚡ Inbox button task), which answers in that same file, 👍/👎 go to `prefs.json`, and pictures he pastes or Claude adds (to an answer, or to a PR card next to its Merge button) live in `pictures/`, which only the signed-in API hands out. Nothing private is in this repo, and pictures of the feed in PRs use sample data.
- **Its keys (once, about 5 minutes on GitHub):**
    1. **Sign-in app:** [github.com/settings/applications/new](https://github.com/settings/applications/new): name `Muse Feed`, Homepage URL and Authorization callback URL both `https://muselabs.app/feed/` (the callback isn't used), tick **Enable Device Flow**, **Register application**. Copy its **Client ID** (not a secret; no client secret is needed) into this repo's **Settings › Secrets and variables › Actions › Variables** as `FEED_GITHUB_CLIENT_ID`.
    2. **Vault key:** [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new): name `Muse Feed work site` (GitHub refused a name with a slash in it), resource owner jasonmuse, expiration up to a year, **Only select repositories: muse-os**, Repository permissions › **Contents: Read and write**. Generate, save it in Bitwarden, and add it as the repository secret `FEED_GITHUB_TOKEN`.
    3. **Ping key (optional):** the ⚡ Inbox button token from Bitwarden ("Muse OS inbox button") as the repository secret `FEED_FIRE_TOKEN`. Without it, what he sends waits for Claude's next check (4:43am, 12:39pm, 8:39pm).
    4. **Re-run the last deploy** (Actions › Deploy muselabs.app › Re-run all jobs). Each deploy copies the keys to Cloudflare (`scripts/feed-keys.sh`, names only in the log).
- **Sign every device out:** change `FEED_GITHUB_TOKEN` (the sign-in cookies are signed with a key made from it), or add a `FEED_SESSION_SECRET`.
- **How it stays private:** the vault key only ever lives on Cloudflare's side; the page can only load its own files (a strict Content-Security-Policy in `site/_headers`); the API only accepts JSON from its own page, only GitHub account 146852983 (jasonmuse) can sign in, and the cookie is HttpOnly, Secure and SameSite=Strict.

## If something goes wrong
- **A change broke the site:** revert the PR on GitHub (it deploys the old version), or in Cloudflare: Workers & Pages › muselabs › Deployments › an older one › **Rollback**. The last hand-uploaded zip is in that list too.
- **The deploy says the new version isn't live:** Cloudflare may treat a branch other than `main` as the live one. In Cloudflare: Workers & Pages › muselabs › Settings › Builds & deployments (or Branch control) › set the production branch to `main`, then re-run the deploy.
- **"Authentication error":** the key is missing the Cloudflare Pages · Edit permission, or the Account ID is for the other account.

## Where this came from
Copied from the live muselabs.app on Nov 21, 2026 (the last hand-uploaded zip), including the pages nothing links to (`/frogquest/`, `app-ads.txt`, the custom 404 page) and its three redirects (`site/_redirects`). Cloudflare's email protection was undone in the copy; Cloudflare adds it back when it serves the pages.
