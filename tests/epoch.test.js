/**
 * Unit tests for epoch-helpers.js — epoch selector, filename generation,
 * manifest compatibility, URL round-trip, and cross-epoch joining safety.
 *
 * Run: node --test tests/epoch.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const epoch = require('../lib/epoch-helpers.js');

// ═══════════════════════════════════════════════════════════════════════════
// resolveEpochs — manifest v3 epoch metadata discovery
// ═══════════════════════════════════════════════════════════════════════════

describe('resolveEpochs', () => {
  it('returns empty for null manifest', () => {
    assert.deepEqual(epoch.resolveEpochs(null), []);
  });

  it('returns empty for manifest without epochs field', () => {
    assert.deepEqual(epoch.resolveEpochs({ throughput_workloads: ['get-k16-v16-t7-p10'] }), []);
  });

  it('returns empty for manifest with empty epochs array', () => {
    assert.deepEqual(epoch.resolveEpochs({ epochs: [] }), []);
  });

  it('returns empty for manifest with non-array epochs', () => {
    assert.deepEqual(epoch.resolveEpochs({ epochs: 'v1' }), []);
  });

  it('resolves builtin v1 epoch by id alone', () => {
    const result = epoch.resolveEpochs({ epochs: [{ id: 'v1' }] });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'v1');
    assert.equal(result[0].label, 'Legacy v1 (stock generator)');
    assert.equal(result[0].generator, 'stock');
  });

  it('resolves builtin v2 epoch by id alone', () => {
    const result = epoch.resolveEpochs({ epochs: [{ id: 'v2' }] });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'v2');
    assert.equal(result[0].label, 'Scalable v2 (patched generator)');
    assert.equal(result[0].generator, 'patched');
  });

  it('allows manifest to override builtin labels', () => {
    const result = epoch.resolveEpochs({
      epochs: [{ id: 'v1', label: 'Custom V1', generator: 'custom-gen' }],
    });
    assert.equal(result[0].label, 'Custom V1');
    assert.equal(result[0].generator, 'custom-gen');
  });

  it('handles unknown epoch ids gracefully', () => {
    const result = epoch.resolveEpochs({
      epochs: [{ id: 'experimental' }],
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'experimental');
    assert.equal(result[0].label, 'experimental');
    assert.equal(result[0].generator, 'unknown');
  });

  it('resolves multiple epochs preserving order', () => {
    const result = epoch.resolveEpochs({
      epochs: [{ id: 'v1' }, { id: 'v2' }, { id: 'v3', label: 'Mixed s20 v2' }],
    });
    assert.equal(result.length, 3);
    assert.equal(result[0].id, 'v1');
    assert.equal(result[1].id, 'v2');
    assert.equal(result[2].id, 'v3');
    assert.equal(result[2].label, 'Mixed s20 v2');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// availableEpochs — cross-platform intersection
// ═══════════════════════════════════════════════════════════════════════════

describe('availableEpochs', () => {
  it('returns empty for null manifests', () => {
    assert.deepEqual(epoch.availableEpochs(null), []);
  });

  it('returns empty for empty manifests', () => {
    assert.deepEqual(epoch.availableEpochs({}), []);
  });

  it('returns empty when no manifest has epochs (v2 manifest compat)', () => {
    assert.deepEqual(epoch.availableEpochs({
      arm64: { throughput_workloads: ['x'] },
      amd64: { throughput_workloads: ['x'] },
    }), []);
  });

  it('returns epochs from single platform', () => {
    const result = epoch.availableEpochs({
      arm64: { epochs: [{ id: 'v1' }, { id: 'v2' }] },
    });
    assert.equal(result.length, 2);
    assert.equal(result[0].id, 'v1');
    assert.equal(result[1].id, 'v2');
  });

  it('computes intersection across platforms', () => {
    const result = epoch.availableEpochs({
      arm64: { epochs: [{ id: 'v1' }, { id: 'v2' }] },
      amd64: { epochs: [{ id: 'v2' }] },
    });
    // Only v2 is on both
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'v2');
  });

  it('ignores platforms without epoch metadata (v2 manifests)', () => {
    const result = epoch.availableEpochs({
      arm64: { epochs: [{ id: 'v1' }, { id: 'v2' }] },
      amd64: { throughput_workloads: ['x'] }, // v2 manifest, no epochs
    });
    // amd64 has no epochs field — treated as non-epoch-aware, excluded from intersection
    assert.equal(result.length, 2);
  });

  it('preserves order from first epoch-aware manifest', () => {
    const result = epoch.availableEpochs({
      arm64: { epochs: [{ id: 'v2' }, { id: 'v1' }] },
      graviton4: { epochs: [{ id: 'v1' }, { id: 'v2' }] },
    });
    // Order from arm64 (first key)
    assert.equal(result[0].id, 'v2');
    assert.equal(result[1].id, 'v1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// seriesFilename — v1 vs v2+ file naming
// ═══════════════════════════════════════════════════════════════════════════

describe('seriesFilename', () => {
  const base = 'series-arm64-get-k16-v16-t7-p10-throughput';

  it('v1 (null epoch) produces unqualified filename', () => {
    assert.equal(epoch.seriesFilename(base, null), base + '.json');
  });

  it('v1 (empty string) produces unqualified filename', () => {
    assert.equal(epoch.seriesFilename(base, ''), base + '.json');
  });

  it('v1 (explicit "v1") produces unqualified filename', () => {
    assert.equal(epoch.seriesFilename(base, 'v1'), base + '.json');
  });

  it('v2 produces epoch-qualified filename', () => {
    assert.equal(
      epoch.seriesFilename(base, 'v2'),
      base + '.epoch-v2.json'
    );
  });

  it('arbitrary epoch produces epoch-qualified filename', () => {
    assert.equal(
      epoch.seriesFilename(base, 'exp-cachecannon'),
      base + '.epoch-exp-cachecannon.json'
    );
  });

  it('v1 and v2 filenames are DISTINCT (no overwriting)', () => {
    const f1 = epoch.seriesFilename(base, 'v1');
    const f2 = epoch.seriesFilename(base, 'v2');
    assert.notEqual(f1, f2, 'v1 and v2 must produce different filenames');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// seriesUrl — full URL construction
// ═══════════════════════════════════════════════════════════════════════════

describe('seriesUrl', () => {
  const dataUrl = 'https://data.conductress.rainsupreme.net';

  it('builds legacy URL for null epoch', () => {
    assert.equal(
      epoch.seriesUrl(dataUrl, 'arm64', 'get-k16-v16-t7-p10', 'throughput', null),
      'https://data.conductress.rainsupreme.net/series-arm64-get-k16-v16-t7-p10-throughput.json'
    );
  });

  it('builds epoch-qualified URL for v2', () => {
    assert.equal(
      epoch.seriesUrl(dataUrl, 'arm64', 'get-k16-v16-t7-p10', 'throughput', 'v2'),
      'https://data.conductress.rainsupreme.net/series-arm64-get-k16-v16-t7-p10-throughput.epoch-v2.json'
    );
  });

  it('works with memory metric', () => {
    assert.equal(
      epoch.seriesUrl(dataUrl, 'amd64', 'memory-set-k16-v64', 'memory', 'v2'),
      'https://data.conductress.rainsupreme.net/series-amd64-memory-set-k16-v64-memory.epoch-v2.json'
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// notableUrl / manifestUrl
// ═══════════════════════════════════════════════════════════════════════════

describe('notableUrl', () => {
  const dataUrl = 'https://data.example.com';

  it('legacy notable URL for null epoch', () => {
    assert.equal(epoch.notableUrl(dataUrl, 'arm64', null), dataUrl + '/notable-arm64.json');
  });

  it('legacy notable URL for v1 epoch', () => {
    assert.equal(epoch.notableUrl(dataUrl, 'arm64', 'v1'), dataUrl + '/notable-arm64.json');
  });

  it('epoch-qualified notable URL for v2', () => {
    assert.equal(epoch.notableUrl(dataUrl, 'arm64', 'v2'), dataUrl + '/notable-arm64.epoch-v2.json');
  });
});

describe('manifestUrl', () => {
  const dataUrl = 'https://data.example.com';

  it('legacy manifest URL for null epoch', () => {
    assert.equal(epoch.manifestUrl(dataUrl, 'arm64', null), dataUrl + '/manifest-arm64.json');
  });

  it('epoch-qualified manifest URL for v2', () => {
    assert.equal(epoch.manifestUrl(dataUrl, 'arm64', 'v2'), dataUrl + '/manifest-arm64.epoch-v2.json');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// URL hash round-trip
// ═══════════════════════════════════════════════════════════════════════════

describe('URL hash round-trip', () => {
  it('null epoch does not set hash param', () => {
    const params = new URLSearchParams();
    epoch.writeEpochToHash(params, null);
    assert.equal(params.has('epoch'), false);
  });

  it('v1 epoch does not set hash param (default)', () => {
    const params = new URLSearchParams();
    epoch.writeEpochToHash(params, 'v1');
    assert.equal(params.has('epoch'), false);
  });

  it('v2 epoch sets hash param', () => {
    const params = new URLSearchParams();
    epoch.writeEpochToHash(params, 'v2');
    assert.equal(params.get('epoch'), 'v2');
  });

  it('round-trip: write v2 then parse gets v2', () => {
    const params = new URLSearchParams();
    epoch.writeEpochToHash(params, 'v2');
    const parsed = epoch.parseEpochFromHash(params);
    assert.equal(parsed, 'v2');
  });

  it('round-trip: write null then parse gets null', () => {
    const params = new URLSearchParams();
    epoch.writeEpochToHash(params, null);
    const parsed = epoch.parseEpochFromHash(params);
    assert.equal(parsed, null);
  });

  it('parse returns null when epoch absent', () => {
    const params = new URLSearchParams('platform=arm64&workload=x');
    assert.equal(epoch.parseEpochFromHash(params), null);
  });

  it('overwrites existing epoch param', () => {
    const params = new URLSearchParams('epoch=v2');
    epoch.writeEpochToHash(params, 'v3');
    assert.equal(params.get('epoch'), 'v3');
  });

  it('clears epoch param when switching back to v1', () => {
    const params = new URLSearchParams('epoch=v2');
    epoch.writeEpochToHash(params, 'v1');
    assert.equal(params.has('epoch'), false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// No cross-epoch joining — filename isolation
// ═══════════════════════════════════════════════════════════════════════════

describe('no cross-epoch joining', () => {
  const base = 'series-arm64-get-k16-v16-t7-p10-throughput';

  it('different epochs produce different filenames', () => {
    const files = ['v1', 'v2', 'v3', null, ''].map(e => epoch.seriesFilename(base, e));
    // v1, null, '' all map to the same legacy file
    assert.equal(files[0], files[3]); // v1 === null
    assert.equal(files[0], files[4]); // v1 === ''
    // v2 is different from v1
    assert.notEqual(files[0], files[1]);
    // v3 is different from both
    assert.notEqual(files[0], files[2]);
    assert.notEqual(files[1], files[2]);
  });

  it('fetching one epoch cannot accidentally include another', () => {
    // The filename pattern ensures no overlap: .json vs .epoch-v2.json
    const legacy = epoch.seriesFilename(base, null);
    const v2 = epoch.seriesFilename(base, 'v2');
    assert.ok(!legacy.includes('epoch-'), 'legacy file must not contain epoch qualifier');
    assert.ok(v2.includes('epoch-v2'), 'v2 file must contain epoch-v2 qualifier');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// shortLabel / epochWorkloadSuffix
// ═══════════════════════════════════════════════════════════════════════════

describe('shortLabel', () => {
  it('returns V1 with generator hint for builtin v1', () => {
    assert.equal(epoch.shortLabel({ id: 'v1', label: 'Legacy v1 (stock generator)' }), 'V1 (stock generator)');
  });

  it('returns V2 with generator hint', () => {
    assert.equal(epoch.shortLabel({ id: 'v2', label: 'Scalable v2 (patched generator)' }), 'V2 (patched generator)');
  });

  it('returns bare ID when no parenthetical', () => {
    assert.equal(epoch.shortLabel({ id: 'v3', label: 'Future epoch' }), 'V3');
  });

  it('returns Legacy for null', () => {
    assert.equal(epoch.shortLabel(null), 'Legacy');
  });
});

describe('epochWorkloadSuffix', () => {
  it('returns empty for null/v1', () => {
    assert.equal(epoch.epochWorkloadSuffix(null), '');
    assert.equal(epoch.epochWorkloadSuffix('v1'), '');
  });

  it('returns bracketed ID for v2', () => {
    assert.equal(epoch.epochWorkloadSuffix('v2'), ' [V2]');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Manifest compatibility — v2 manifests (no epochs) still work
// ═══════════════════════════════════════════════════════════════════════════

describe('manifest compatibility', () => {
  it('v2 manifest (no epochs) produces legacy filenames', () => {
    const manifests = {
      arm64: { throughput_workloads: ['get-k16-v16-t7-p10'] },
    };
    const epochs = epoch.availableEpochs(manifests);
    assert.equal(epochs.length, 0, 'no epochs should be discovered');
    // Dashboard should use null epoch — which gives legacy filenames
    const url = epoch.seriesUrl('https://x', 'arm64', 'get-k16-v16-t7-p10', 'throughput', null);
    assert.equal(url, 'https://x/series-arm64-get-k16-v16-t7-p10-throughput.json');
  });

  it('mixed v2+v3 manifests: only epoch-aware platforms participate', () => {
    const manifests = {
      arm64: { epochs: [{ id: 'v1' }, { id: 'v2' }], throughput_workloads: ['x'] },
      amd64: { throughput_workloads: ['x'] }, // v2 manifest
      intel: { epochs: [{ id: 'v1' }, { id: 'v2' }], throughput_workloads: ['x'] },
    };
    const epochs = epoch.availableEpochs(manifests);
    // amd64 excluded from intersection; arm64 + intel both have v1+v2
    assert.equal(epochs.length, 2);
    assert.equal(epochs[0].id, 'v1');
    assert.equal(epochs[1].id, 'v2');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Epoch auto-selection rule
// ═══════════════════════════════════════════════════════════════════════════

describe('epoch auto-selection', () => {
  it('sole epoch should be auto-selected (caller logic)', () => {
    const epochs = epoch.availableEpochs({
      arm64: { epochs: [{ id: 'v2' }] },
    });
    // When epochs.length === 1, the dashboard should auto-select epochs[0]
    assert.equal(epochs.length, 1);
    assert.equal(epochs[0].id, 'v2');
    // No selector dropdown should be shown (UX: caller hides it)
  });

  it('zero epochs means legacy mode (no selector)', () => {
    const epochs = epoch.availableEpochs({
      arm64: { throughput_workloads: ['x'] },
    });
    assert.equal(epochs.length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Integration: BUILTIN_EPOCHS
// ═══════════════════════════════════════════════════════════════════════════

describe('BUILTIN_EPOCHS', () => {
  it('contains v1 and v2', () => {
    assert.ok(epoch.BUILTIN_EPOCHS.some(e => e.id === 'v1'));
    assert.ok(epoch.BUILTIN_EPOCHS.some(e => e.id === 'v2'));
  });

  it('v1 has stock generator', () => {
    assert.equal(epoch.BUILTIN_EPOCHS.find(e => e.id === 'v1').generator, 'stock');
  });

  it('v2 has patched generator', () => {
    assert.equal(epoch.BUILTIN_EPOCHS.find(e => e.id === 'v2').generator, 'patched');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Static structure: epoch-helpers.js is loadable and exports expected API
// ═══════════════════════════════════════════════════════════════════════════

describe('epoch-helpers API surface', () => {
  const expected = [
    'BUILTIN_EPOCHS', 'resolveEpochs', 'availableEpochs',
    'seriesFilename', 'seriesUrl', 'notableUrl', 'manifestUrl',
    'parseEpochFromHash', 'writeEpochToHash',
    'shortLabel', 'epochWorkloadSuffix',
  ];

  for (const name of expected) {
    it(`exports ${name}`, () => {
      assert.ok(name in epoch, `missing export: ${name}`);
    });
  }
});
