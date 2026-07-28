# Watchlist alerts

The DoomStreak site keeps a small, read-only watchlist in the visitor's browser.
It does not require a connected wallet or a DoomStreak account.

## What is checked

Each watched token stores its last successful snapshot and compares it with the
next one. The site records an alert when it observes:

- a risk-score move of at least five points or a risk-bucket change;
- a liquidity fall greater than 50%;
- another launch by the same creator;
- a Doom Record tier change or a score move of at least five points;
- a new creator commitment default or recent liquidity failure;
- a Doom commitment changing from active to completed or defaulted;
- another completed GM check-in; or
- loss of creator LP-fee eligibility.

Watched creator addresses use the creator-only subset of those checks.

## Storage and refresh model

Snapshots and the latest 20 alert-history entries are stored in browser
`localStorage`. They remain on that browser until the visitor clears site data,
removes an entry, or clears the alert history.

Checks run when the site loads, when the Watchlist is opened, and when **Check
now** is selected. This first version is not a background service and does not
send push, email, or Telegram notifications.

## Safety and data limits

- The watchlist is read-only and never requests a transaction or signature.
- It is an observation aid, not an insurance promise or safety guarantee.
- Alerts depend on the indexer's freshness, completeness, and latest available
  on-chain snapshot.
- Missing or unavailable data does not create an alert.
- A liquidity alert compares two observed snapshots; it does not claim the
  decrease happened continuously between those checks.

Server-side alert subscriptions and faster NFT-gated alerts remain a later
analytics milestone after authentication, delivery, and abuse controls are
designed.
