#!/usr/bin/env bash
# Gives Muse Feed (muselabs.app/feed) its keys: copies them from this repo's GitHub secrets and variables to
# the Cloudflare Pages project, where the /feed/api functions read them.
#
# The keys go to production only. Preview copies get none: every pull request gets a preview that runs that
# pull request's own code, so a key there is a key any branch can read. Each run also takes every FEED_* name
# off the preview side. And it only works for a push to main, never for a run a pull request started.
#
# Runs before the deploy, so a key added or changed on GitHub reaches the site with the next deploy.
# Keys that aren't set on GitHub stay as they are on Cloudflare. Prints names only, never values.
# Needs CF_TOKEN, CF_ACCOUNT and PAGES_PROJECT, plus whichever FEED_* keys are set.
set -uo pipefail

SECRETS=(FEED_GITHUB_TOKEN FEED_FIRE_TOKEN FEED_SESSION_SECRET)   # the vault key, the ⚡ ping key, the cookie-signing key
PLAIN=(FEED_GITHUB_CLIENT_ID FEED_SESSION_EPOCH)                   # not secret
summary="${GITHUB_STEP_SUMMARY:-/dev/null}"
warn() { echo "::warning title=Muse Feed keys::$1"; }

if [ "${GITHUB_EVENT_NAME:-}" != "push" ] || [ "${GITHUB_REF:-}" != "refs/heads/main" ]; then
  echo "Muse Feed: its keys only travel with a push to main, so this run sent nothing."
  exit 0
fi

if [ -z "${CF_TOKEN:-}" ] || [ -z "${CF_ACCOUNT:-}" ] || [ -z "${PAGES_PROJECT:-}" ]; then
  warn "CF_TOKEN, CF_ACCOUNT and PAGES_PROJECT have to be set, so Muse Feed's keys weren't sent."
  exit 0
fi
project="https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT/pages/projects/$PAGES_PROJECT"
out="$(mktemp)"
trap 'rm -f "$out"' EXIT

# cloudflare METHOD [body]: the answer lands in $out, its status in $code. The body goes in on stdin,
# so a value never shows up in a command line or the log.
cloudflare() {
  if [ $# -gt 1 ]; then
    code="$(printf '%s' "$2" | curl -s -o "$out" -w '%{http_code}' -X "$1" \
      -H "Authorization: Bearer $CF_TOKEN" -H 'Content-Type: application/json' --data-binary @- "$project")"
  else
    code="$(curl -s -o "$out" -w '%{http_code}' -X "$1" -H "Authorization: Bearer $CF_TOKEN" "$project")"
  fi
  [ "$code" = "200" ] && [ "$(jq -r '.success // false' "$out" 2>/dev/null)" = "true" ]
}
trouble() { echo "HTTP $code$(jq -r '[.errors[]?.message] | join("; ") | if . == "" then "" else ": " + . end' "$out" 2>/dev/null)"; }
feed_names() { jq -r --arg side "$1" '[.result.deployment_configs[$side].env_vars // {} | keys[] | select(startswith("FEED_"))] | join(" ")' "$out" 2>/dev/null; }

# 1. Production gets every key that's set on GitHub.
set_names=()
for n in "${SECRETS[@]}" "${PLAIN[@]}"; do
  [ -n "${!n:-}" ] && set_names+=("$n")
done
if [ ${#set_names[@]} -eq 0 ]; then
  echo "Muse Feed: no keys on GitHub yet (${SECRETS[*]} ${PLAIN[*]}), so /feed stays on its Almost ready page."
else
  body="$(jq -n --arg secrets "${SECRETS[*]}" --arg plain "${PLAIN[*]}" '
    def vars(names; t): [names | split(" ")[] | select((env[.] // "") != "") | {(.): {type: t, value: env[.]}}] | add // {};
    {deployment_configs: {production: {env_vars: (vars($secrets; "secret_text") + vars($plain; "plain_text"))}}}')"
  if cloudflare PATCH "$body"; then
    echo "Muse Feed: gave Cloudflare ${set_names[*]} (production only)."
    echo "### Muse Feed keys, production only: ${set_names[*]}" >> "$summary"
  else
    # Don't hold up the rest of the site (the App Store pages matter more); say it loudly instead.
    warn "Cloudflare didn't take Muse Feed's keys ($(trouble)). The site still deploys; /feed may not sign in until this works."
  fi
fi

# 2. Previews get none: take off every FEED_* name that's there (all the names this script knows, if it can't look).
if cloudflare GET; then stale="$(feed_names preview)"; else stale="${SECRETS[*]} ${PLAIN[*]}"; fi
if [ -n "$stale" ]; then
  body="$(jq -n --arg names "$stale" '{deployment_configs: {preview: {env_vars: ([$names | split(" ")[] | {(.): null}] | add)}}}')"
  cloudflare PATCH "$body" || warn "Cloudflare didn't clear Muse Feed's keys from previews ($(trouble)). Take $stale out of the Pages project's Preview variables by hand."
fi

# 3. Look again, and say what previews hold now.
if cloudflare GET; then
  left="$(feed_names preview)"
  if [ -z "$left" ]; then
    echo "Muse Feed: previews hold no keys."
    echo "### Muse Feed keys on previews: none" >> "$summary"
  else
    warn "Previews still hold $left. Take them out of the Pages project's Preview variables by hand (Cloudflare › Workers & Pages › $PAGES_PROJECT › Settings)."
  fi
else
  warn "Couldn't check what previews hold ($(trouble))."
fi
exit 0
