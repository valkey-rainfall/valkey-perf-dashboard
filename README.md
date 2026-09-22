# Valkey Performance Dashboard

Static dashboard showing historical performance of [valkey-io/valkey](https://github.com/valkey-io/valkey) `unstable` branch.

Powered by [Conductress](https://github.com/rainsupreme/valkey-conductress) sweep mode — adaptive hierarchical bisection that progressively identifies the most impactful PRs.

## How it works

1. Conductress runs on benchmark hosts, progressively benchmarking merge commits
2. Results are exported to `data/series-{platform}.json`
3. GitHub Pages serves this static dashboard
4. The dashboard fetches JSON at load time and renders interactive charts

## Data format

Each platform has its own `series-{platform}.json`:
- `arm64` — Graviton 3 (c7g.metal)
- `amd64` — AMD EPYC 9R14
- `intel` — Intel Sapphire Rapids

## Local development

```bash
python3 -m http.server 8080 --bind 127.0.0.1
# Open http://localhost:8080
```

## Epoch selector

An epoch is a measurement generation (a specific load generator and methodology).
When a platform manifest declares more than one epoch, a selector appears; the page
opens on the first epoch that is not marked `archived` (an explicit `#epoch=<id>`
hash still wins, and manifests that predate the flag fall back to the first listed
epoch), and archived epochs stay selectable but are labelled "(archived)" in the
muted color.

The comparison page reads its engines and its throughput, memory, and latency
workloads from the selected epoch's per-platform manifests, so it compares only the
engines and workloads that epoch actually measured.

### Engines and sweep scope

Only engines flagged `history: true` in `config.js` (`ENGINES`) appear on the
Performance History page: they are swept across the full commit history and have
a per-commit line to show. A release-and-tip engine (Redis: latest release plus a
tip at most once a day, no bisection) appears only on the comparison page.

The comparison page opens with a freshness strip, one row per engine. For each
engine it shows the release the "At Releases" numbers come from and the HEAD the
"Current HEAD" numbers come from: release label when known, short SHA, commit
date, and the age of that commit (day resolution; a point's `date` is the commit
date, not the measurement time). A dot per column says whether every sweep in the
roster sits on that same commit: green all on one commit, yellow spread over more
than one, red at least one sweep has no such point. Expanding the count lists each
sweep. "Current HEAD" for a release-and-tip engine is its newest tip point; for a
history engine it stays the median of the last five points.

## Tests

The test suite uses Node.js 22's built-in test runner and has no third-party dependencies:

```bash
node --test tests/unit.test.js
node tests/status-monitoring.test.js
```

The unit suite covers status rendering and escaping, fleet-control severity, queue and duration formatting, statistical comparison helpers, workload parsing, page/module integration, HTML structure, and JSON fixtures. GitHub Actions runs these tests plus JavaScript syntax, JSON, HTML, and inclusive-language checks on pushes and pull requests.

## Score range and client-saturated points

Conductress v3 points carry extra per-result metadata. When a point reports
`score_min`/`score_max`, the series chart draws a dashed **range band** around the
line (distinct from the shaded CV band): a wide range with a small CV usually means
the per-rep scores split into two modes. When a point reports client (load
generator) telemetry, a **saturated marker** (a hollow diamond in the warning color)
flags points where `client_saturated` is true — the load generator was at or over
its core budget, so the number is the *client's* ceiling, not the server's. Hover a
point (or open the commit popup / compare tooltip) to see the exact range, client
utilization, and a caveat when the point is saturated. Older points and v1 series
omit these keys and render as "unknown" rather than as a false or zero value.
