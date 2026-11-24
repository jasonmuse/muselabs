#!/usr/bin/env bash
# Gives Muse Feed (muselabs.app/feed) its keys: copies them from this repo's GitHub secrets (and the
# FEED_GITHUB_CLIENT_ID variable) to the Cloudflare Pages project, where the /feed/api functions read them.
# Runs before each deploy, so a key added or changed on GitHub reaches the site with the next deploy.
# Keys that aren't set yet are skipped (the feed shows its "Almost ready" page). Prints names only, never values.
# Needs CF_TOKEN, CF_ACCOUNT and PAGES_PROJECT, plus whichever FEED_* keys are set.
set -uo pipefail

set_names=()
for n in FEED_GITHUB_TOKEN FEED_GITHUB_CLIENT_ID FEED_FIRE_TOKEN; do
  [ -n "${!n:-}" ] && set_names+=("$n")
done
if [ ${#set_names[@]} -eq 0 ]; then
  echo "Muse Feed: no keys on GitHub yet (FEED_GITHUB_TOKEN, FEED_GITHUB_CLIENT_ID, FEED_FIRE_TOKEN), so /feed stays on its Almost ready page."
  exit 0
fi

# Values go from the environment straight into the request body (never into a command line or the log).
body="$(jq -n '
  def key(n; t): if (env[n] // "") != "" then {(n): {type: t, value: env[n]}} else {} end;
  (key("FEED_GITHUB_TOKEN"; "secret_text") + key("FEED_FIRE_TOKEN"; "secret_text") + key("FEED_GITHUB_CLIENT_ID"; "plain_text")) as $e
  | {deployment_configs: {production: {env_vars: $e}, preview: {env_vars: $e}}}')"

out="$(mktemp)"
code="$(printf '%s' "$body" | curl -s -o "$out" -w '%{http_code}' -X PATCH \
  -H "Authorization: Bearer $CF_TOKEN" -H 'Content-Type: application/json' --data-binary @- \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT/pages/projects/$PAGES_PROJECT")"
ok="$(jq -r '.success // false' "$out" 2>/dev/null)"
errs="$(jq -r '[.errors[]?.message] | join("; ")' "$out" 2>/dev/null)"
rm -f "$out"

if [ "$code" = "200" ] && [ "$ok" = "true" ]; then
  echo "Muse Feed: gave Cloudflare ${set_names[*]} (production and previews)."
  echo "### Muse Feed keys: ${set_names[*]}" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
else
  # Don't hold up the rest of the site (the App Store pages matter more); say it loudly instead.
  echo "::warning title=Muse Feed keys::Cloudflare didn't take Muse Feed's keys (HTTP $code${errs:+: $errs}). The site still deploys; /feed may not sign in until this works."
fi
exit 0
