// Dashboard configuration: constants, colors, and help text.

const DATA_URL = 'https://data.conductress.rainsupreme.net';
const PLATFORMS = ['amd64', 'arm64', 'intel'];
const PLATFORM_LABELS = { arm64: 'ARM (Graviton 3)', amd64: 'AMD (EPYC 9R14)', intel: 'Intel (Sapphire Rapids)' };
const MEMORY_WORKLOADS = ['memory-set-64b', 'memory-zadd-64b', 'memory-sadd-64b', 'memory-set-64b-expire'];

const CATEGORY_COLORS = {
  embedded_obj: '#6366f1', sds: '#10b981', hashtable: '#f59e0b', skiplist: '#ef4444',
  robj: '#ec4899', listpack: '#06b6d4', dict: '#8b5cf6', server_infra: '#84cc16', other: '#6b7280',
  'tma-retiring-pct': '#22c55e', 'tma-fe-bound-pct': '#f59e0b', 'tma-be-bound-pct': '#ef4444', 'tma-bad-spec-pct': '#8b5cf6',
};
const CHART_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899'];

// Help text for each section. Keys match section IDs used by showHelp().
const HELP_TEXT = {
  throughput: {
    title: 'Throughput',
    content: `
      <p><strong>What it measures:</strong> Peak requests/second for a single Valkey instance under a fixed workload (GET 16-byte values, io-threads, pipelined).</p>
      <p><strong>How to read it:</strong> Each point is one commit on the unstable branch. The shaded band shows the coefficient of variation (CV) — measurement uncertainty. Points outside the band are real changes.</p>
      <p><strong>What matters:</strong></p>
      <ul>
        <li><span style="color:var(--ok)">Green dots</span> = detected improvement (≥2% sustained)</li>
        <li><span style="color:var(--danger)">Red dots</span> = detected regression</li>
        <li>CV &lt; 1% = high confidence; CV &gt; 3% = noisy measurement</li>
      </ul>
      <p><strong>Methodology:</strong> 3–7 repetitions per commit, adaptive targeting 0.5% CV. Server restarted + caches dropped between reps. CPU pinned, boost/turbo disabled, ASLR off.</p>
    `
  },
  perf: {
    title: 'Performance Counters',
    content: `
      <p><strong>What they measure:</strong> Hardware PMU counters collected via <code>perf stat</code> during the benchmark run, normalized per instruction or per request.</p>
      <p><strong>Metrics:</strong></p>
      <ul>
        <li><strong>IPC</strong> (Instructions Per Cycle) — CPU efficiency. Higher = better. Valkey typically 2.4–3.4 depending on platform.</li>
        <li><strong>Instructions/request</strong> — code path length. Increases mean more work per operation (new features, overhead).</li>
        <li><strong>Icache MPKI</strong> — instruction cache misses per 1K instructions. High values (&gt;5) suggest code bloat or hot path fragmentation.</li>
        <li><strong>LLC MPKI</strong> — last-level cache misses per 1K instructions. High values indicate memory-bound behavior (random hash lookups).</li>
        <li><strong>Branch MPKI</strong> — branch mispredictions per 1K instructions. Usually stable for Valkey (~2–4).</li>
        <li><strong>Frontend/Backend Stall %</strong> — fraction of cycles the CPU is stalled waiting for instructions (frontend) or data (backend).</li>
      </ul>
      <p><strong>Interpreting changes:</strong> A throughput regression paired with rising instructions/request = new code overhead. Rising LLC-MPKI without code changes = data structure growth or layout change.</p>
    `
  },
  tma: {
    title: 'Pipeline Breakdown (TMA)',
    content: `
      <p><strong>What it measures:</strong> Intel Top-Down Microarchitecture Analysis Level 1. Decomposes all pipeline slots into four categories that sum to ~100%.</p>
      <p><strong>Categories:</strong></p>
      <ul>
        <li><span style="color:#22c55e">■</span> <strong>Retiring</strong> — useful work completed. Higher = better. Valkey typical: ~34%.</li>
        <li><span style="color:#f59e0b">■</span> <strong>Frontend Bound</strong> — stalled on instruction fetch/decode. High → icache pressure, complex branches. Typical: ~10%.</li>
        <li><span style="color:#ef4444">■</span> <strong>Backend Bound</strong> — stalled on execution or memory. High → cache misses, memory latency from random hash lookups. Typical: ~48%.</li>
        <li><span style="color:#8b5cf6">■</span> <strong>Bad Speculation</strong> — wasted work from mispredicted branches. Typical: ~8%.</li>
      </ul>
      <p><strong>For Valkey:</strong> Backend-bound dominates because the main loop does random hash table lookups (pointer chasing, poor cache locality). Improvements to data structure layout directly reduce backend stalls.</p>
      <p><strong>Only available on Intel</strong> (Sapphire Rapids). ARM and AMD use different stall metrics.</p>
    `
  },
  memory: {
    title: 'Memory Overhead',
    content: `
      <p><strong>What it measures:</strong> Per-key memory overhead in bytes, decomposed by allocation category using jemalloc heap profiling.</p>
      <p><strong>Categories:</strong></p>
      <ul>
        <li><strong>sds</strong> — Simple Dynamic Strings (key names + string values)</li>
        <li><strong>hashtable</strong> — main keyspace hash table buckets</li>
        <li><strong>dict</strong> — dict metadata structures</li>
        <li><strong>robj</strong> — Redis object headers (type, encoding, refcount, LRU)</li>
        <li><strong>embedded_obj</strong> — objects with embedded SDS (optimization)</li>
        <li><strong>skiplist</strong> — sorted set skip list nodes (zadd only)</li>
        <li><strong>listpack</strong> — compact encoding for small collections</li>
        <li><strong>server_infra</strong> — fixed server overhead amortized per key (buffers, event loop, replication state)</li>
      </ul>
      <p><strong>How to read:</strong> Total height = total bytes/key. A commit that reduces <code>robj</code> by 8B saved one pointer per key. The <code>server_infra</code> band is tiny because it's fixed cost ÷ 5M keys.</p>
      <p><strong>Methodology:</strong> Deterministic (1 rep, CV=0). Server built with <code>--enable-prof</code>, heap dumped on shutdown via <code>prof_final</code>.</p>
    `
  },
};

// Help modal logic
function showHelp(sectionId) {
  const h = HELP_TEXT[sectionId]; if (!h) return;
  let modal = document.getElementById('helpModal');
  if (!modal) {
    modal = document.createElement('div'); modal.id = 'helpModal';
    modal.innerHTML = `<div class="help-backdrop" onclick="closeHelp()"></div><div class="help-content"><div class="help-header"><span class="help-title"></span><button class="help-close" onclick="closeHelp()">✕</button></div><div class="help-body"></div></div>`;
    document.body.appendChild(modal);
  }
  modal.querySelector('.help-title').textContent = h.title;
  modal.querySelector('.help-body').innerHTML = h.content;
  modal.style.display = 'flex';
}
function closeHelp() { const m = document.getElementById('helpModal'); if (m) m.style.display = 'none'; }
