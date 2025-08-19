/* --- simple helpers --- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// --- numeric helpers (canonical units = shares in 0..1) ---
const asNum = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const to01  = (v) => (asNum(v) > 1 ? asNum(v) / 100 : asNum(v));  // tolerate 0..100

// ---------- numeric safety helpers ----------
const num = (v, d=0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
// accepts 0..1 or 0..100; returns 0..1
const toPct01 = (v) => {
  const n = num(v, 0);
  return n > 1 ? n/100 : n;
};

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

// Deterministic PRNG (seeded) & helpers for labels
function mulberry32(a) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
}

function months25() {
  return Array.from({length:25}, (_,i) => i-12).map(x => 
    x === 0 ? 'M' : (x < 0 ? `−${Math.abs(x)}` : `+${x}`)
  );
}

// Policy thresholds for risk computation
const POLICY_THRESHOLDS = {
  EU: { deltaHigh: 150, postHigh: 2500, deltaMed: 100, postMed: 2000 },
  SA: { deltaHigh: 100, postHigh: 2000, deltaMed: 50,  postMed: 1500 }
};

// Single source of truth for risk computation
function computeRiskLevel({ preHHI, postHHI, policy }) {
  const thresholds = POLICY_THRESHOLDS[policy || 'EU'];
  const delta = postHHI - preHHI;
  
  // Check High risk first (most restrictive)
  if (delta >= thresholds.deltaHigh || postHHI >= thresholds.postHigh) return 'High';
  
  // Then check Medium risk
  if (delta >= thresholds.deltaMed || postHHI >= thresholds.postMed) return 'Medium';
  
  // Otherwise Low risk
  return 'Low';
}

// ---- Local mirror of backend math (single source when offline) ----
const BREADTH_ALPHA = 0.30;

function dynamicFringeFloor(flex, entry, innov) {
  // Copy from backend/app.py exactly
  const base = 0.20;                               // 20% baseline
  const breadth = 0.15 * flex;                     // + up to 15% when market is broad
  const barriers = -0.10 * entry;                  // - up to 10% when barriers are high
  const innov_fx = 0.05 * (innov - 1.0);           // +/- up to 5% around 1.0

  const f = base + breadth + barriers + innov_fx;
  return Math.min(0.50, Math.max(0.10, f));        // clamp 10%..50%
}

function normalizeShares(rawShares = [], params = {}) {
  const floor = num(dynamicFringeFloor(params.flex, params.entry, params.innov), 0); // 0..1
  const inside = rawShares.map(b => ({...b, share: toPct01(b?.share)}));
  const insideSum = inside.reduce((a,b) => a + num(b.share), 0);
  const residual = Math.max(0, 1 - floor);
  const scaled = insideSum > 0
    ? inside.map(b => ({...b, share: num(b.share)/insideSum * residual}))
    : inside.map(b => ({...b, share: 0}));
  const totalInside = scaled.reduce((a,b) => a + num(b.share), 0);
  const fringe = Math.max(0, 1 - totalInside);
  const structure = {
    inside: scaled.map(b => ({ name: b.name, share: num(b.share) })),
    fringe,
    fringe_floor: floor
  };
  return { scaled, fringe, fringe_floor: floor, structure };
}

// Accepts:
//  • array of shares [0.32, 0.23, ...] OR array of objs [{name, share}, ...]
//  • object { inside:[number|{share}], fringe:number }
function hhiFromComponents(input) {
  if (!input) return 0;
  let shares = [];
  if (Array.isArray(input)) {
    shares = input.map(x => typeof x === 'number' ? toPct01(x) : toPct01(x?.share));
  } else if (typeof input === 'object') {
    const inside = Array.isArray(input.inside) ? input.inside : [];
    const fringe = toPct01(input.fringe);
    const insideShares = inside.map(x => typeof x === 'number' ? toPct01(x) : toPct01(x?.share));
    shares = [...insideShares, fringe];
  } else {
    return 0;
  }
  return Math.round(shares.reduce((acc, s) => acc + (100 * num(s)) ** 2, 0));
}

function applyMarketBreadth(inside, fringe, flex) {
  // Apply market breadth (flex) to expand fringe and rescale inside
  const insideSum = inside.reduce((a, b) => a + b, 0);
  const reassign = BREADTH_ALPHA * flex * insideSum;
  const scale = insideSum > 0 ? (insideSum - reassign) / insideSum : 1;
  const insideAdj = inside.map(s => s * scale);
  const fringeAdj = Math.min(1, Math.max(0, fringe + reassign));
  
  // Normalize to ensure total = 1
  const total = insideAdj.reduce((a, b) => a + b, 0) + fringeAdj;
  const norm = total > 0 ? 1 / total : 1;
  return {
    inside: insideAdj.map(s => s * norm),
    fringe: fringeAdj * norm
  };
}

function hhiPostMerge(scaled, fringe, selectedNames) {
  const selSet = new Set(selectedNames || []);
  const merged = scaled.filter(b => selSet.has(b.name)).reduce((a, b) => a + b.share, 0);
  const rivals = scaled.filter(b => !selSet.has(b.name)).map(b => b.share);
  return hhiFromComponents([merged, ...rivals, fringe]);
}

// Price impact model — COPY coefficients from backend/app.py
function priceImpactBps(deltaHHI, params) {
  // Same as backend: (2.0 + 0.02*hhi_delta) * (1 + 0.5*conduct) * (1 + 0.3*entry) * (1 - 0.2*innov)
  const base = 2.0 + 0.02 * deltaHHI;
  return base * (1 + 0.5 * params.conduct) * (1 + 0.3 * params.entry) * (1 - 0.2 * params.innov);
}

function passThrough(conduct, flex, entry) {
  // Same as backend: 0.3 + 0.4*conduct + 0.2*entry - 0.1*flex
  return Math.max(0.05, Math.min(0.95, 0.3 + 0.4 * conduct + 0.2 * entry - 0.1 * flex));
}

function computeWelfare(bps, pass_through, conduct, entry, innov) {
  // COPY backend's mapping to R bn exactly
  const k = 1.0 / 15.0;  // +15 bps ≈ R1bn consumer effect
  // Consumer loses only the passed-through share of price increase
  const cons = -pass_through * bps * k;

  // Efficiency channel (innovation & entry reduce harm / raise producer surplus)
  const alpha = 0.70;  // weight of innovation
  const beta = 0.40;   // weight of entry
  const gamma = 0.30;  // conduct dampens efficiencies if high
  const efficiency = Math.max(0.0, alpha * (innov - 1.0) + beta * entry - gamma * conduct);

  // Producer (merged) gain: (1 - pass_through)*bps + efficiency kicker
  const merged = (1.0 - pass_through) * bps * k * 0.6 + efficiency;

  // Non-merging banks: small gain if pass_through high (they ride the price),
  // small loss if pass_through low (competition / share erosion)
  const rivals = (pass_through >= 0.5 ? 0.10 : -0.05) * bps * k;

  // Deadweight loss ∝ pass_through * bps but *reduced* by efficiencies
  const dwl_base = 0.50 * pass_through * bps * k;
  const deadweight = -Math.max(0.0, dwl_base * (1.0 - 0.6 * Math.min(1.0, efficiency)));  // negative = loss

  const net = cons + merged + rivals + deadweight;
  return {
    cons: Math.round(cons * 1000) / 1000,
    merged: Math.round(merged * 1000) / 1000,
    rivals: Math.round(rivals * 1000) / 1000,
    deadweight: Math.round(deadweight * 1000) / 1000,
    net: Math.round(net * 1000) / 1000
  };
}

function simulateSeries(seed, base, bpsImpact, params, actualPreMonths = 12) {
  const rand = mulberry32(seed);
  const months = Array.from({length:25}, (_,i) => i-12).map(x => 
    x === 0 ? 'M' : (x < 0 ? `−${Math.abs(x)}` : `+${x}`)
  );
  const actual = [];
  let v = base;
  
  for (let i = 0; i < 25; i++) {
    if (i < actualPreMonths) {
      const noise = (rand() - 0.5) * 10; // ±5 bps
      v = base + noise;
      actual.push(Math.round(v));
    } else {
      actual.push(null);
    }
  }
  
  // VMM: follow actual pre with tiny offset; post drift by bps/12
  const vmm = [];
  const bandLo = [], bandHi = [];
  const lastPre = actual.slice(0, actualPreMonths).filter(x => x != null).slice(-1)[0] ?? base;
  const drift = bpsImpact / 12;
  
  for (let i = 0; i < 25; i++) {
    if (i < actualPreMonths) {
      const off = (rand() - 0.5) * 2; // ±1 bps so it's visible, but close
      vmm.push((actual[i] ?? lastPre) + off);
    } else {
      const steps = i - (actualPreMonths - 1);
      const impact_factor = Math.min(steps / 6.0, 1.0);  // Gradual ramp-up over 6 months
      const drift_amount = bpsImpact * impact_factor;
      const noise = (rand() - 0.5) * 5;
      vmm.push(Math.round(base + drift_amount + noise));
    }
    
    // Confidence band (wider for post-merger projections)
    if (i < 12) {
      // Pre-merger: tight band
      bandLo.push(vmm[i] - 3);
      bandHi.push(vmm[i] + 3);
    } else {
      // Post-merger: wider band due to uncertainty
      bandLo.push(vmm[i] - 6);
      bandHi.push(vmm[i] + 6);
    }
  }
  
  return { months, actual, vmm, band: { lower: bandLo, upper: bandHi } };
}

function computeMetricsLocally(payload) {
  const { banks, params, policy } = payload;
  const { scaled, fringe, fringe_floor, structure } = normalizeShares(banks, params);
  const pre = hhiFromComponents(structure); // tolerant + consistent
  const selectedNames = banks.filter(b => b.selected).map(b => b.name);
  const post = hhiPostMerge(scaled, fringe, selectedNames);
  const delta = post - pre;
  const bps = priceImpactBps(delta, params);
  const pt = passThrough(params.conduct, params.flex, params.entry);
  const w = computeWelfare(bps, pt, params.conduct, params.entry, params.innov);
  const seed = cyrb53(JSON.stringify({ banks, params, policy }));
  const series = simulateSeries(seed, 150, bps, params, 12);
  const risk = computeRiskLevel({ preHHI: pre, postHHI: post, policy });
  return {
    policy,
    hhi: { pre, post, delta: post - pre },
    bpsImpact: bps,
    passThrough: pt,
    welfare: w,
    series,
    structure: { inside: structure.inside.map(x => ({ share: x.share })), fringe: structure.fringe }
  };
}

// ---- Backend feature flag (OFF by default for Netlify/static) ----
const USE_BACKEND = false;  // set true only when backend is running
const BACKEND_URL = (window.BACKEND_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');

async function backendHealthy() {
  try {
    const res = await fetch(`${BACKEND_URL}/health`, { cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
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
    return `${s}${v.toFixed ? v.toFixed(1) : String(v)} bps`;
  },

  // pass-through 2 decimals (e.g., "0.52×") - ensure only one ×
  pass2: (x) => {
    if (!Number.isFinite(x)) return "0.00×";
    const v = Math.round(x * 100) / 100;
    return `${v.toFixed ? v.toFixed(2) : String(v)}×`;
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
    return `${s}${prefix}${Math.abs(v).toFixed ? Math.abs(v).toFixed(1) : String(Math.abs(v))} bn`;
  }
};

// ---------- API Configuration ----------
const API_BASE = window.API_BASE_URL || 'http://localhost:8000';
let lastMetrics = null; // Store last metrics for download

// === SHARE NORMALIZATION WITH FRINGE GUARDRAIL (single source for UI) ===
// Backend is the single source of truth for share normalization
// Frontend sends raw slider values and displays normalized values from backend

// Build state from UI - send raw shares to backend for normalization
function buildStateFromUI() {
  // Collect UI bank shares in 0..1 (raw, not normalized)
  const banks = Array.from(document.querySelectorAll('.share-row')).map(row => {
    const name = row.getAttribute('data-bank'); // must match backend canonical names
    const slider = row.querySelector('.share-input');
    const sharePct = slider ? Number(slider.value) : 0;
    const cb = document.querySelector(`.bank-select[data-bank="${name}"]`);
    return {
      name,
      selected: cb ? cb.checked : true,
      share: Math.max(0, Math.min(100, sharePct)) / 100
    };
  });

  // Return raw banks (0..1) - backend will normalize
  return { banks };
}

// HHI computation from normalized components (if needed client-side)
function hhiFromComponents(norm) {
  // norm: { banks:[{share}], fringe }
  // HHI on 0..100 scale: sum (s_i * 100)^2 over banks + fringe
  const comp = [...norm.banks.map(b => b.share), norm.fringe];
  return Math.round(comp.reduce((sum, s)=> sum + Math.pow(s*100, 2), 0));
}

function setRiskPill(level) {
  const pill = document.getElementById('riskPill');
  const text = document.getElementById('riskText');
  if (!pill || !text) {
    console.warn('[RISK] pill or text span missing');
    return;
  }
  // Normalize
  const L = (level || 'Low').toString();
  // Update text
  text.textContent = L;
  // Update background class
  pill.classList.remove('low','med','high');
  pill.classList.add(L === 'High' ? 'high' : L === 'Medium' ? 'med' : 'low');

  // Self-check
  console.log('[RISK_PILL_SET]', { backend: L, pillClass: pill.className, text: text.textContent });
}

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

// 1) Read UI -> payload with raw shares
function buildStateFromUI() {
  // Collect raw bank shares from UI
  const banks = Array.from(document.querySelectorAll('.share-row')).map(row => {
    const name = row.getAttribute('data-bank');
    const slider = row.querySelector('.share-input');
    const sharePct = slider ? Number(slider.value) : 0;
    const cb = document.querySelector(`.bank-select[data-bank="${name}"]`);
    return {
      name,
      selected: cb ? cb.checked : true,
      share: Math.max(0, Math.min(100, sharePct)) / 100
    };
  });
  
  // params
  const params = {
    conduct: Number($('#conduct').value),
    flex: Number($('#flex').value),
    entry: Number($('#entry').value),
    innov: Number($('#innov').value)
  };
  const policy = document.querySelector('.btn-toggle.active')?.dataset?.regime || 'EU';
  
  // Return raw banks (0..1) - backend will normalize with dynamic fringe
  return { 
    banks, 
    params, 
    policy 
  };
}

// 2) Fetch metrics from backend
async function fetchMetrics(state) {
  const res = await fetch(`${BACKEND_URL}/metrics`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state)
  });
  if (!res.ok) throw new Error(`Backend /metrics ${res.status}`);
  return res.json();
}

async function fetchMetricsOrLocal(payload) {
  // BACKEND first, fallback to LOCAL if backend fails
  try {
    return await fetchMetrics(payload);
  } catch (e) {
    console.warn('[FALLBACK] backend failed → using local compute', e);
    return computeMetricsLocally(payload);
  }
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

  // Guard against zero HHI
  if (!m?.hhi || !Number.isFinite(m.hhi.pre) || !Number.isFinite(m.hhi.post)) {
    m.hhi = { pre: 0, post: 0, delta: 0 };
  }

  // Compute risk level locally using the same HHI values displayed in KPIs
  const risk = computeRiskLevel({
    preHHI: Number(m?.hhi?.pre)  || 0,
    postHHI: Number(m?.hhi?.post) || 0,
    policy: m?.policy || Store.policy
  });

  // Headline
  const selectedBanks = m.banks?.filter(b=>b.selected).map(b=>b.name==='Standard Bank'?'Standard':b.name) || [];
  el.headline.innerHTML = `
    <strong>Takeout (${selectedBanks.join(' + ')}):</strong>
    Under current assumptions (<b>${m.policy}</b> thresholds, Risk: <b>${m?.risk || 'Low'}</b>),
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
            label: c => (c.raw > 0 ? '+' : '') + (c.raw.toFixed ? c.raw.toFixed(1) : String(c.raw)) + ' R bn'
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
    
    // Verification logging
    console.log('[VERIFY:UI]', {
      bankPct: payload.banks.map(b=>({n:b.name, pct: Math.round(b.share*100)})),
      params: payload.params
    });
    
    console.log('[PAYLOAD]', JSON.stringify(payload, null, 2));

    let m;
    try {
      m = await fetchMetricsOrLocal(payload);
    } catch (e) {
      console.error('[FATAL] fetchMetricsOrLocal failed', e);
      m = {
        policy: payload.policy, risk:'Low',
        hhi:{pre:0,post:0,delta:0}, bpsImpact:0, passThrough:0,
        welfare:{cons:0,merged:0,rivals:0,deadweight:0,net:0},
        series:{ months:Array.from({length:25},(_,i)=>i-12), actual:Array(25).fill(null),
                 vmm:Array(25).fill(null), band:{lower:Array(25).fill(null), upper:Array(25).fill(null)} },
        structure:{ inside: payload.banks.map(b=>({name:b.name, share: toPct01(b.share)})), fringe:0, fringe_floor:0 }
      };
    }
    lastMetrics = m; // Store for download

    // --- extract structure in canonical 0..1 units BEFORE any use ---
    const inside01 = (m?.structure?.inside || []).map(s => Number(s?.share) || 0);
    const fringe01 = Number(m?.structure?.fringe) || 0;
    const total01  = inside01.reduce((a,b)=>a+b,0) + fringe01;

    // Set risk pill from backend
    setRiskPill(m?.risk || 'Low');

    // Quick console assertions (so you can trust it)
    console.assert(
      document.getElementById('riskText')?.textContent === (m?.risk || 'Low'),
      'Risk text mismatch',
      { ui: document.getElementById('riskText')?.textContent, backend: m?.risk }
    );

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

    // Update UI with normalized shares from backend
    if (m?.structure) {
      const inside = m.structure.inside;
      const fringe = m.structure.fringe;
      
      // Update bank sliders and labels with normalized values
      const bankRows = document.querySelectorAll('.share-row');
      bankRows.forEach((row, i) => {
        if (i < inside.length) {
          const slider = row.querySelector('.share-input');
          const label = row.querySelector('.share-val');
          const pct = Math.round(inside[i] * 100);
          if (slider) slider.value = pct;
          if (label) label.textContent = `${pct}%`;
        }
      });
      
      // Update fringe label
      {
        const lbl = document.getElementById('fringeLabel');
        if (lbl) lbl.textContent = `Fringe: ${Math.round(fringe01 * 100)}%`;
      }
      
    }

    // Verification logging
    console.log('[VERIFY]', {
      inside: inside01,           // shares in 0..1
      fringe: fringe01,           // 0..1
      total:  total01.toFixed(6), // should be "1.000000"
    });

    // Risk verification logging
    const computedRisk = computeRiskLevel({
      preHHI: Number(m?.hhi?.pre)  || 0,
      postHHI: Number(m?.hhi?.post) || 0,
      policy: m?.policy || Store.policy
    });
    console.log('[RISK_VERIFY]', {
      policy: m?.policy || Store.policy,
      preHHI: m?.hhi?.pre, 
      postHHI: m?.hhi?.post, 
      delta: (m?.hhi?.post || 0) - (m?.hhi?.pre || 0),
      thresholds: POLICY_THRESHOLDS[m?.policy || Store.policy],
      computedRisk,
      backendRisk: m?.risk
    });

    // (Optional) Add a quick console check after compute
    console.log('[VERIFY:LOCAL]', { inside: inside01, fringe: fringe01, sharesSum: total01.toFixed(6), hhi: m.hhi, risk: m.risk, bps: m.bpsImpact });
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
    // Update Store.policy to match the selected policy
    Store.policy = btn.dataset.regime || 'EU';
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

// (Optional) Silence the MetaMask noise in dev
if (window.ethereum && typeof window.ethereum.request === 'function') {
  // leave it; user controls wallet
} else {
  // no wallet; skip connect attempts if any third-party script tries
}

// (Optional) Silence that MetaMask noise (it's from a browser extension)
window.addEventListener('unhandledrejection', (e) => {
  if (String(e.reason||'').includes('MetaMask')) e.preventDefault();
}, true);
