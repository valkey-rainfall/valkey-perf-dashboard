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

## Tests

The test suite uses Node.js 22's built-in test runner and has no third-party dependencies:

```bash
node --test tests/unit.test.js
node tests/status-monitoring.test.js
```

The unit suite covers status rendering and escaping, fleet-control severity, queue and duration formatting, statistical comparison helpers, workload parsing, page/module integration, HTML structure, and JSON fixtures. GitHub Actions runs these tests plus JavaScript syntax, JSON, HTML, and inclusive-language checks on pushes and pull requests.
