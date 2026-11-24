#!/usr/bin/env bash
# Before deploying: make sure the files behind the addresses in urls.txt are in site/,
# so a deploy can't drop an App Store page or app-ads.txt by accident.
set -uo pipefail
site="${1:-site}"
fail=0
for f in index.html 404.html _redirects app-ads.txt robots.txt sitemap.xml \
         poof/index.html poof/privacy.html poof/terms.html \
         penguin/index.html penguin/privacy.html frogquest/index.html \
         assets/style.css assets/labs.css assets/home.css assets/og-muselabs.jpg \
         _headers feed/index.html feed/app.js feed/feed.css feed/sw.js feed/manifest.webmanifest; do
  if [ -s "$site/$f" ]; then echo "ok    $f"; else echo "MISSING  $site/$f"; fail=1; fi
done
exit $fail
