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

`launch-detail/` — the public page for one launch, at
<http://127.0.0.1:4181/web/launch-detail/?launch=1>.

Every figure is read from the chain, pinned to a single block, so the page is
complete without the indexer. It asks the indexer only how far behind it is, with
a timeout, and says so on the page. On 2026-08-02 that read reported the indexer
several hundred thousand blocks behind while the page itself was two seconds old.

Three distinctions it keeps carefully:

- **Deadline missed is not defaulted.** After a missed window anyone *can*
  finalise the default, but until they do the tokens have not moved. The page
  says exactly that rather than declaring the streak dead early.
- **Permanent liquidity needs two proofs.** The launch record is the factory's
  claim about the past; `ownerOf` read now is the chain's answer today. The word
  "permanent" appears only when both agree, and the page names the block it
  checked.
- **A resolved commitment has no deadline.** The contract returns zero once a
  streak ends, so the page shows a dash instead of a date in 1970.

If a read fails, the page shows why and hides everything else. Partial figures
about locked money are worse than no figures.

`discovery/` — the list every launch is found from, at
<http://127.0.0.1:4181/web/discovery/>.

Launches are enumerated from the factory's own `launchCount` and read one by one
at a single pinned block, so the list works when the indexer does not. That is one
round trip per launch, which is fine for a three-launch cap; a public factory would
read the list from the indexer and keep this as the fallback.

The categories are the ones this launchpad can actually compute: deadline missed,
check-in due now, streak alive, survived, dead. There is deliberately no
"Trending" — that needs trade volume nobody here measures — and no "Graduating",
which belongs to the bonding curve deferred with the v4 work. Rows are ordered by
how close a creator is to losing their allocation, because that countdown is the
thing this product has and others do not.

Two details worth keeping if this is rewritten:

- The page opens on "Needs a check-in" only when something is actually there.
  Landing on an empty tab makes a healthy launchpad look broken.
- Token names and symbols come from contracts anyone can deploy. They are stripped
  of control characters and inserted with `textContent`, never as markup, and a
  test enforces both.

## Not built yet

- Image upload and pinning. The image stays in the browser for now.
- A launch list or discovery page. The detail page takes `?launch=<id>` for now.
- Anything that depends on the public factory, which does not exist.
