/* --- simple helpers --- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// map possible labels -> canonical key used in data-bank attributes
const NAME_MAP = {
  'Standard Bank':'Standard',
  'Standard':'Standard',
  'ABSA':'ABSA',
  'FNB':'FNB',
  'Nedbank':'Nedbank'
};

// tiny deterministic hash for seeds (no deps)
function cyrb53(str, seed=0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/* --- debug check --- */
console.log('Script.js loaded');
console.log('Chart.js available:', typeof Chart !== 'undefined');
console.log('Canvas elements:', {
  prices: !!$('#chartPrices'),
  welfare: !!$('#chartWelfare')
});

// ---------- Formatting helpers (single source for rounding) ----------
const fmt = {
  // integers
  int: (x) => Number.isFinite(x) ? Math.round(x) : 0,

  // HHI is integer
  hhi: (x) => Number.isFinite(x) ? Math.round(x) : 0,

  // 1 decimal bps (e.g., "+23.1 bps") - ensure only one + sign
  bps1: (x) => {
    if (!Number.isFinite(x)) return "0.0 bps";
    const v = Math.round(x * 10) / 10;
    const s = v > 0 ? "+" : "";
    return `${s}${v.toFixed(1)} bps`;
  },

  // pass-through 2 decimals (e.g., "0.52×") - ensure only one ×
  pass2: (x) => {
    if (!Number.isFinite(x)) return "0.00×";
    return `${(Math.round(x * 100) / 100).toFixed(2)}×`;
  },

  // whole-number percent (e.g., "32%")
  pctInt: (x) => {
    if (!Number.isFinite(x)) return "0%";
    return `${Math.round(x)}%`;
  },

  // billions with 1 decimal, with sign
  moneyBn1: (x, prefix = "R ") => {
    if (!Number.isFinite(x)) return `${prefix}0.0 bn`;
    const v = Math.round(x * 10) / 10;
    const s = v > 0 ? "+" : (v < 0 ? "−" : "");
    return `${s}${prefix}${Math.abs(v).toFixed(1)} bn`;
  }
};

// ---------- API Configuration ----------
const API_BASE = window.API_BASE_URL || 'http://localhost:8000';
let lastMetrics = null; // Store last metrics for download

// ---------- Helper Functions ----------
function baseSubstitutionLabel() {
  const { flex } = Store.params;
  if (flex < 0.3) return "Low";
  if (flex < 0.7) return "Medium";
  return "High";
}

/* --- single source of truth --- */
const Store = {
  banks: {
    "Standard Bank": { share: 0.32, selected: true },
    "ABSA": { share: 0.23, selected: true },
    "FNB": { share: 0.25, selected: false },
    "Nedbank": { share: 0.20, selected: false }
  },
  params: {
    conduct: 0.35,
    flex: 0.40,
    entry: 0.60,
    innov: 1.00
  },
  policy: 'EU', // default policy regime
  seed: 123456 // fixed seed for deterministic results
};

/* --- elements (outputs) --- */
const el = {
  kpiPrice: $("#kpiPrice"),
  kpiPriceTile: $("#kpiPriceTile"),
  kpiDelta: $("#kpiDelta"),
  kpiPre: $("#kpiPre"),
  kpiPost: $("#kpiPost"),
  kpiPT: $("#kpiPT"),
  kpiSub: $("#kpiSub"),
  hhiPre: $("#hhiPre"),
  hhiPost: $("#hhiPost"),
  hhiDelta: $("#hhiDelta"),
  welfare: $("#welfare"),
  welfareSign: $("#welfareSign"),
  boxPre: $("#boxPre"),
  boxPost: $("#boxPost"),
  boxDelta: $("#boxDelta"),
  riskLabel: $("#riskPill span"),
  headline: $("#headline"),
  netWelfare: $("#netWelfare")
};

/* --- inputs --- */
const inputs = {
  conduct: $("#conduct"),
  flex: $("#flex"),
  entry: $("#entry"),
  innov: $("#innov")
};

/* --- fringe and share management --- */
function getInsideShares() {
  const bankKeys = Object.keys(Store.banks);
  const getShare = (k) => Store.banks[k].share * 100;
  const setShare = (k, v) => { 
    Store.banks[k].share = v / 100; 
    // Update UI slider
    const slider = document.querySelector(`[data-bank="${k}"] .share-input`);
    if (slider) {
      slider.value = v;
      slider.nextElementSibling.textContent = `${v}%`;
    }
  };
  const setFringeLabel = (txt) => {
    // Update fringe label if it exists
    const fringeEl = document.querySelector('[data-id="fringe-label"]');
    if (fringeEl) fringeEl.textContent = `Fringe: ${txt}`;
  };

  const result = enforceFringe({ 
    minFringe: FRINGE_MIN * 100, 
    bankKeys, 
    getShare, 
    setShare, 
    setFringeLabel 
  });

  return {
    inside: Object.values(Store.banks).map(b => b.share),
    fringe: result.fringe / 100
  };
}

// Apply market breadth (flex) → expand fringe (outside options) and rescale inside
function applyMarketBreadth(inside, fringe, flex) {
  const insideSum = inside.reduce((a,b)=>a+b, 0);
  const reassign = BREADTH_ALPHA * flex * insideSum;     // move a share of inside to fringe
  const scale = insideSum > 0 ? (insideSum - reassign)/insideSum : 1;
  const insideAdj = inside.map(s => s * scale);
  const fringeAdj = Math.min(1, Math.max(0, fringe + reassign));
  // normalize tiny floating drift
  const total = insideAdj.reduce((a,b)=>a+b,0) + fringeAdj;
  const norm = total > 0 ? 1/total : 1;
  return { inside: insideAdj.map(s=>s*norm), fringe: fringeAdj*norm };
}

function computeHHI({ inside, fringe }) {
  // HHI as sum of squared market shares (in percentage points)
  const s2 = inside.map(s => (100 * s) ** 2);
  const hhiFringe = (100 * fringe) ** 2;
  return Math.round(s2.reduce((a, b) => a + b, 0) + hhiFringe);
}

// Cyrb53 hash function for deterministic seed generation
function cyrb53(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

// 1) Read UI -> payload
function buildStateFromUI() {
  // banks: normalize names so lookups match data-bank attributes
  const banks = [];
  $$('.bank-select').forEach(chk => {
    const raw = chk.dataset.bank;
    const name = NAME_MAP[raw] || raw;
    const row = document.querySelector(`.share-row[data-bank="${name}"]`);
    const sharePct = row ? Number(row.querySelector('.share-input').value) : 0;
    banks.push({ name, selected: chk.checked, share: sharePct / 100 });
  });

  // params
  const params = {
    conduct: Number($('#conduct').value),
    flex: Number($('#flex').value),
    entry: Number($('#entry').value),
    innov: Number($('#innov').value)
  };
  const policy = document.querySelector('.btn-toggle.active')?.dataset?.regime || 'EU';
  // seed will be set in recompute()
  return { banks, params, policy };
}

// 2) Fetch metrics from backend
async function fetchMetrics(state) {
  const base = API_BASE; // Use the constant defined at the top
  const res = await fetch(`${base}/metrics`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state)
  });
  if (!res.ok) throw new Error(`metrics failed: ${res.status}`);
  return res.json();
}

// Update KPIs and headline
function updateKpis(m) {
  if (!m) return;
  
  // KPIs
  el.kpiPrice.textContent = fmt.bps1(m.bpsImpact);
  el.kpiPriceTile.textContent = fmt.bps1(m.bpsImpact);
  el.kpiDelta.textContent = `${fmt.hhi(m.hhi.delta)} ΔHHI`;
  el.kpiPre.textContent = fmt.hhi(m.hhi.pre);
  el.kpiPost.textContent = fmt.hhi(m.hhi.post);
  el.kpiPT.textContent = fmt.pass2(m.passThrough);
  
  // Base substitution label
  const flex = m.params?.flex || 0.4;
  el.kpiSub.textContent = flex < 0.3 ? 'Low' : flex < 0.7 ? 'Medium' : 'High';

  // HHI boxes
  el.hhiPre.textContent = fmt.hhi(m.hhi.pre);
  el.hhiPost.textContent = fmt.hhi(m.hhi.post);
  el.hhiDelta.textContent = `${fmt.hhi(m.hhi.delta)}`;

  // Welfare
  el.welfare.textContent = fmt.moneyBn1(Math.abs(m.welfare.cons));
  el.welfareSign.textContent = m.welfare.cons < 0 ? "−" : "+";
  
  // Box values
  el.boxPre.textContent = fmt.hhi(m.hhi.pre);
  el.boxPost.textContent = fmt.hhi(m.hhi.post);
  el.boxDelta.textContent = `${fmt.hhi(m.hhi.delta)}`;

  // Risk pill
  const pill = document.getElementById('riskPill');
  pill.classList.remove('low','med','high');
  pill.classList.add(m.risk === 'High' ? 'high' : m.risk === 'Medium' ? 'med' : 'low');
  el.riskLabel.textContent = m.risk;

  // Headline
  const selectedBanks = m.banks?.filter(b=>b.selected).map(b=>b.name==='Standard Bank'?'Standard':b.name) || [];
  el.headline.innerHTML = `
    <strong>Takeout (${selectedBanks.join(' + ')}):</strong>
    Under current assumptions (<b>${m.policy}</b> thresholds, Risk: <b>${m.risk}</b>),
    the merger is associated with an average CDS premium impact of
    <b>${fmt.bps1(m.bpsImpact)}</b>, concentration rising from
    <b>HHI ${fmt.hhi(m.hhi.pre)} → ${fmt.hhi(m.hhi.post)}</b>
    (<b>${fmt.hhi(m.hhi.delta)} ΔHHI</b>), and a net welfare effect of
    <b>${fmt.moneyBn1(m.welfare.net)}</b>.
  `;
  
  el.netWelfare.textContent = `Net Welfare Effect: ${fmt.moneyBn1(m.welfare.net)}`;
}

function ensureDatasetOrder() {
  if (!priceChart) return;

  // Desired order:
  // 0 = bandLower (area), 1 = bandUpper (hidden line), 2 = Actual, 3 = VMM
  const ds = priceChart.data.datasets || [];

  function makeBand(label) {
    return {
      label,
      data: [],
      fill: 'origin',
      backgroundColor: 'rgba(127,225,195,0.10)',
      borderColor: 'rgba(127,225,195,0.15)',
      borderWidth: 0,
      pointRadius: 0,
      spanGaps: true,
      tension: 0.25
    };
  }
  function makeLine(label, color, dashed=false) {
    return {
      label,
      data: [],
      borderColor: color,
      backgroundColor: 'transparent',
      borderWidth: 2,
      borderDash: dashed ? [6,6] : [],
      pointRadius: 0,
      tension: 0.25,
      spanGaps: true
    };
  }

  const need = (priceChart.data.datasets.length < 4);
  if (need) {
    priceChart.data.datasets = [
      makeBand('VMM Band (Lower)'),
      makeLine('VMM Band (Upper)', 'rgba(127,225,195,0.01)'), // effectively invisible line cap
      makeLine('Actual (pre-merger)', '#8fb4ff', false),
      makeLine('VMM Estimate', '#7fe1c3', true)
    ];
  }
}

function updateCharts(m) {
  if (!priceChart || !m || !m.series) return;

  ensureDatasetOrder();

  const months = m.series.months || [];
  const actual = m.series.actual || [];
  const vmm = m.series.vmm || [];
  const lower = m.series.band?.lower || [];
  const upper = m.series.band?.upper || [];

  // Guard against empty arrays so Chart.js never gets undefined
  const safe = (arr, len) => Array.isArray(arr) && arr.length === len ? arr : Array(len).fill(null);
  const L = months.length || Math.max(actual.length, vmm.length, lower.length, upper.length, 25);

  priceChart.data.labels = months.length ? months : Array.from({length:L}, (_,i)=>i);

  // Dataset order must match ensureDatasetOrder()
  const ds = priceChart.data.datasets;
  ds[0].data = safe(lower, L);       // band lower
  ds[1].data = safe(upper, L);       // band upper (thin line cap)
  ds[2].data = safe(actual, L);      // actual series
  ds[3].data = safe(vmm, L);         // vmm series

  priceChart.update('none');

  // Welfare chart update (if present)
  if (welfareChart && m.welfare) {
    const w = m.welfare;
    const round1 = x => Math.round((Number(x)||0) * 10) / 10;
    welfareChart.data.datasets[0].data = [
      round1(w.cons),
      round1(w.merged),
      round1(w.rivals),
      round1(w.deadweight)
    ];
    welfareChart.update('none');
  }
}

async function calibrateModel() {
  try {
    const response = await fetch(`${API_BASE}/calibrate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ seed: Store.seed })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error calibrating model:', error);
    return { seed: Store.seed, status: 'error', message: error.message };
  }
}

function getMockMetrics() {
  // Fallback mock metrics if API is unavailable
  return {
    hhi: { pre: 1850, post: 2780, delta: 930 },
    bpsImpact: 23.5,
    passThrough: 0.52,
    welfare: { cons: -1.6, merged: 0.4, rivals: -0.2, deadweight: 0.3, net: -1.1 },
    policy: Store.policy,
    risk: "High",
    series: {
      months: Array.from({length: 25}, (_, i) => i-12).map(x => x === 0 ? 'M' : (x < 0 ? `−${Math.abs(x)}` : `+${x}`)),
      actual: Array.from({length: 25}, (_, i) => i < 12 ? 150 + (i * 0.5) : null),
      vmm: Array.from({length: 25}, (_, i) => i < 12 ? 150 + (i * 0.5) + 0.8 : 150 + (i * 0.5) + 0.8 + (i - 11) * 2),
      band: {
        lower: Array.from({length: 25}, (_, i) => i < 12 ? 150 + (i * 0.5) + 0.8 - 4 : 150 + (i * 0.5) + 0.8 + (i - 11) * 2 - 4),
        upper: Array.from({length: 25}, (_, i) => i < 12 ? 150 + (i * 0.5) + 0.8 + 4 : 150 + (i * 0.5) + 0.8 + (i - 11) * 2 + 4)
      }
    },
    diag: { shares_sum: 1.0, tolerance_ok: true, seed: Store.seed }
  };
}

/* --- policy management --- */
function setRegime(regime) {
  Store.policy = regime;
  renderAll();
}

function resetScenario() {
  // Reset to baseline values
  Store.banks = {
    "Standard Bank": { share: 0.32, selected: true },
    "ABSA": { share: 0.23, selected: true },
    "FNB": { share: 0.25, selected: false },
    "Nedbank": { share: 0.20, selected: false }
  };
  Store.params = {
    conduct: 0.35,
    flex: 0.40,
    entry: 0.60,
    innov: 1.00
  };
  
  // Reset UI controls
  inputs.conduct.value = Store.params.conduct;
  inputs.flex.value = Store.params.flex;
  inputs.entry.value = Store.params.entry;
  inputs.innov.value = Store.params.innov;
  
  // Reset bank checkboxes and sliders
  $$('.bank-select').forEach(chk => {
    const bank = chk.dataset.bank;
    chk.checked = Store.banks[bank].selected;
  });
  
  $$('.share-input').forEach(sl => {
    const bank = sl.closest('.share-row').dataset.bank;
    const share = Store.banks[bank].share * 100;
    sl.value = share;
    sl.nextElementSibling.textContent = `${share}%`;
  });
  
  // Re-render everything
  recompute();
}



/* --- charts --- */
let priceChart, welfareChart;



function initCharts() {
  console.log('Initializing charts...');
  
  const ctx1 = document.getElementById('chartPrices');
  if (!ctx1) {
    console.error('chartPrices canvas not found');
    return;
  }
  
  console.log('Chart canvas found:', ctx1);
  
  priceChart = new Chart(ctx1, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'VMM Lower',
          data: [],
          borderColor: 'rgba(0,0,0,0)',
          backgroundColor: 'rgba(127,225,195,0.10)',
          borderWidth: 0,
          pointRadius: 0,
          tension: 0.25,
          spanGaps: true,
          fill: false
        },
        {
          label: 'VMM Upper',
          data: [],
          borderColor: 'rgba(0,0,0,0)',
          backgroundColor: 'rgba(127,225,195,0.10)',
          borderWidth: 0,
          pointRadius: 0,
          tension: 0.25,
          spanGaps: true,
          fill: '-1'
        },
        {
          label: 'Actual (pre-merger)',
          data: [],
          borderColor: '#8fb4ff',
          backgroundColor: 'rgba(143, 180, 255, 0.1)',
          borderWidth: 2,
          pointRadius: 0,
          spanGaps: false,
          tension: 0.25,
          fill: false
        },
        {
          label: 'VMM Estimate',
          data: [],
          borderColor: '#7fe1c3',
          backgroundColor: 'rgba(127, 225, 195, 0.1)',
          borderWidth: 2,
          borderDash: [6, 6],
          pointRadius: 0,
          tension: 0.25,
          spanGaps: true,
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: true,
      resizeDelay: 150,
      plugins: {
        legend: {
          display: true,
          labels: {
            filter: (legendItem, chartData) => {
              // Hide confidence ribbon from legend (datasets 0,1)
              return legendItem.datasetIndex >= 2;
            }
          }
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          filter: (tooltipItem) => {
            // Hide confidence ribbon from tooltips (datasets 0,1)
            return tooltipItem.datasetIndex >= 2;
          }
        }
      },
      scales: {
        x: { 
          grid: { color: 'rgba(255,255,255,0.06)' },
          ticks: { color: '#a9b4c7', maxRotation: 0 }
        },
        y: { 
          grid: { color: 'rgba(255,255,255,0.06)' },
          ticks: { 
            callback: v => `${v} bps`,
            color: '#a9b4c7'
          }
        }
      }
    }
  });

  const ctx2 = document.getElementById('chartWelfare');
  if (!ctx2) {
    console.error('chartWelfare canvas not found');
    return;
  }
  
  welfareChart = new Chart(ctx2, {
    type: 'bar',
    data: {
      labels: ['Consumers', 'Merged Entity', 'Non-Merging Banks', 'Deadweight Loss'],
      datasets: [{
        data: [0, 0, 0, 0],
        backgroundColor: [
          'rgba(255,107,107,0.75)',
          'rgba(73,211,154,0.75)',
          'rgba(138,166,193,0.75)',
          'rgba(255,209,102,0.75)'
        ],
        borderColor: [
          'rgba(255,107,107,1)',
          'rgba(73,211,154,1)',
          'rgba(138,166,193,1)',
          'rgba(255,209,102,1)'
        ],
        borderWidth: 1.5,
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      resizeDelay: 150,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: c => (c.raw > 0 ? '+' : '') + c.raw.toFixed(1) + ' R bn'
          }
        }
      },
      scales: {
        x: { 
          grid: { display: false },
          ticks: { color: '#a9b4c7' }
        },
        y: { 
          grid: { color: 'rgba(255,255,255,0.06)' },
          ticks: { 
            callback: v => Math.round(v * 10) / 10 + ' R bn',
            color: '#a9b4c7'
          }
        }
      }
    }
  });
  
  console.log('Charts initialized, priceChart:', priceChart);
}



// 3) Recompute + re-render everything
async function recompute() {
  try {
    const payload = buildStateFromUI();
    // scenario-dependent seed for deterministic series
    payload.seed = cyrb53(JSON.stringify({ banks: payload.banks, params: payload.params, policy: payload.policy }));
    console.log('[PAYLOAD]', JSON.stringify(payload, null, 2));

    const m = await fetchMetrics(payload);
    lastMetrics = m; // Store for download

    // Log explicit fields (not just "Object") so we see variation
    console.log('[BACKEND]', {
      policy: m?.policy,
      risk: m?.risk,
      hhi: m?.hhi,
      bpsImpact: m?.bpsImpact,
      passThrough: m?.passThrough,
      netWelfare: m?.welfare?.net
    });

    // Update KPIs/Headline first (uses single source "m")
    updateKpis(m);

    // Then charts (guarded with dataset order + data presence)
    updateCharts(m);

    const ds = priceChart?.data?.datasets || [];
    console.log('[CHART]', {
      labels: priceChart?.data?.labels?.length,
      actual0: ds[2]?.data?.[0],  // actual
      vmm0: ds[3]?.data?.[0],     // vmm
      band: (m?.series?.band ? 'present' : 'none')
    });

    console.log('[RENDER]', {
      policy: m?.policy, risk: m?.risk,
      hhi: m?.hhi, bps: m?.bpsImpact,
      vmm0: m?.series?.vmm?.[0]
    });
  } catch (err) {
    console.error('recompute failed', err);
  }
}

/* --- sync checkboxes with store --- */
function syncChecks() {
  $$('.bank-select').forEach(chk => {
    const bank = chk.dataset.bank;
    chk.checked = Store.banks[bank].selected;
  });
}

/* --- event listeners --- */
// Bank selection
document.querySelectorAll('.bank-select').forEach(chk => {
  chk.addEventListener('change', recompute);
});

// Bank shares
document.querySelectorAll('.share-input').forEach(sl => {
  sl.addEventListener('input', () => {
    // keep whole percents in UI label
    const v = Math.round(Number(sl.value) || 0);
    sl.value = v;
    sl.nextElementSibling.textContent = `${v}%`;
    recompute();
  });
});

// Sliders (AI/tech params)
['#conduct','#flex','#entry','#innov'].forEach(sel => {
  const elx = document.querySelector(sel);
  if (elx) elx.addEventListener('input', recompute);
});

// EU/SA toggle
document.querySelectorAll('.btn-toggle').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.btn-toggle').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    recompute();
  });
});

// Reset button
document.getElementById('resetBtn')?.addEventListener('click', () => {
  resetScenario();
});

// Calibrate button
$('#calibrateBtn').addEventListener('click', async () => {
  const modal = $('#calibrationModal');
  const resultDiv = $('#calibrationResult');
  
  modal.style.display = 'flex';
  resultDiv.innerHTML = '<p>Calibrating model...</p>';
  
  try {
    const result = await calibrateModel();
    resultDiv.innerHTML = `
      <p><strong>Calibration Complete!</strong></p>
      <p>Seed: ${result.seed}</p>
      <p>Status: ${result.status}</p>
      ${result.hyperparams ? `<p>Hyperparameters: ${JSON.stringify(result.hyperparams, null, 2)}</p>` : ''}
    `;
  } catch (error) {
    resultDiv.innerHTML = `<p><strong>Error:</strong> ${error.message}</p>`;
  }
});

// Close modal
$('#closeModal').addEventListener('click', () => {
  $('#calibrationModal').style.display = 'none';
});

// Download button
$('#downloadBtn').addEventListener('click', () => {
  if (lastMetrics) {
    const dataStr = JSON.stringify(lastMetrics, null, 2);
    const dataBlob = new Blob([dataStr], {type: 'application/json'});
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `merger_metrics_${new Date().toISOString().slice(0,10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  } else {
    alert('No metrics available to download. Please run a simulation first.');
  }
});

/* --- boot --- */
function boot() {
  console.log('Booting application...');
  
  // Wait for DOM to be ready, fonts loaded, and layout settled
  document.addEventListener('DOMContentLoaded', async () => {
    // Wait for fonts to be ready
    if (document.fonts) {
      await document.fonts.ready;
    }
    
    // Wait for next animation frame to ensure layout is settled
    requestAnimationFrame(async () => {
      initCharts();
      syncChecks();
      await recompute(); // <- ensures first render uses backend metrics
    });
  });
}

boot();
