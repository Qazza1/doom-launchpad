# Prototype web pages

Stage 6 work in progress. These pages live in this repository, not on the public
site, and nothing here is deployed. The live site is a separate repository and is
untouched.

## Run it

```powershell
node web/serve.mjs
```

Then open <http://127.0.0.1:4181/>. The server is read-only, listens on localhost
only, and serves nothing outside this repository.

## What is here

`launch-flow/` — the four-step creator journey from Stage 6 of the roadmap:
image, details, review, confirm.

Two properties matter more than the visual design:

**Every number comes from the frozen configuration or the chain.** The allocation
split, the check-in schedule, the creation fee, and the total the wallet will send
are all computed from `config/robinhood-mainnet-canary.decisions.json` and the
deployed factory. Nothing is typed into the page. This is deliberate: the previous
UI plan described a 10% creator allocation for months after the real figure became
0%, and a page built from that document would have promised creators tokens that
do not exist.

**There is no way to send a transaction.** The launch button is disabled and says
why. The page reads the live factory to show how many of its three test launches
remain, and states plainly that the public factory does not exist yet. A test
fails the build if the page ever gains a send path or a signing call.

The confirm screen includes a preview of the four states a real launch moves
through — waiting for a block, failed on chain, mined but not yet indexed, live
and listed. The third one is the state the launchpad was actually in on
2026-08-02, when the token was real and correct but the indexer had not seen it.
Showing it honestly is the point.

## Not built yet

- The token detail page (`/launch/:token`) described in
  `docs/static-site-ui-plan.md`.
- Image upload and pinning. The image stays in the browser for now.
- Anything that depends on the public factory, which does not exist.
