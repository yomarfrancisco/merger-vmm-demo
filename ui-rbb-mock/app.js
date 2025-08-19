// --- Single Source of Truth (mock state) ---
const BANKS = ["Standard B","ABSA","FNB","Nedbank","Fringe"];
const DEFAULT = {
  jurisdiction: "EU",
  mergingOn: { "Standard B": true, "ABSA": false, "FNB": true, "Nedbank": false },
  shares:      { "Standard B": 0.33, "ABSA": 0.24, "FNB": 0.18, "Nedbank": 0.20, "Fringe": 0.05 },
  conduct: 0.25,
  flex: 0.45,
  entry: 0.35,
  innov: 0.20
};
let state = JSON.parse(JSON.stringify(DEFAULT));

// Utility: clamp, format, HHI, sum
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const pct   = (x, d=0) => (100*x).toFixed(d) + "%";
const f1    = x => Number(x).toFixed(1);
const f2    = x => Number(x).toFixed(2);
const fm    = x => (Math.round(x*10)/10).toFixed(1); // compact 1 decimal
const sum   = arr => arr.reduce((a,b)=>a+b,0);
const hhi   = shares => Math.round(sum(shares.map(s => (100*s)**2)));

// EU/SA thresholds for badge
function hhiBadge(pre, post, jur){
  const d = post - pre;
  if (jur === "EU"){
    if (post > 2000 && d >= 150) return "Heightened concern (EU)";
    if (post > 2000 && d >= 100) return "Moderate concern (EU)";
    return "Low concern (EU)";
  } else {
    // SA: illustrative banding aligned to local guidance usage
    if (post > 2000 && d >= 150) return "Heightened concern (SA)";
    if (post > 2000 && d >= 100) return "Moderate concern (SA)";
    return "Low concern (SA)";
  }
}

// Normalize shares so total=1 and Fringe absorbs remainder (>=0.03)
function normalizeShares(){
  const banks = ["Standard B","ABSA","FNB","Nedbank"];
  const totalOthers = sum(banks.map(b=>state.shares[b]));
  state.shares["Fringe"] = clamp(1 - totalOthers, 0.03, 0.40);
  // If fringe got clamped, renormalize proportionally
  const total = sum(BANKS.map(b=>state.shares[b]));
  BANKS.forEach(b => state.shares[b] = state.shares[b]/total);
}

// Simulated pre-merger "actual" series (365d)
function makeActualSeries(){
  const n = 365, base = 120; // 120 bps
  const arr = [];
  for(let t=0;t<n;t++){
    const season = 8*Math.sin(2*Math.PI*t/60);
    const noise  = (Math.random()-0.5)*3;
    arr.push(base + season + noise);
  }
  return arr;
}

// VMM pre fit hugs actual with small error; post = apply price impact trajectory
function makeVMMSeries(actual, avgBps){
  const pre  = actual.map(x => x + (Math.random()-0.5)*1.2); // tight fit
  const nPost = 365;
  // ramp effect over 6 months then plateau
  const post = [];
  for(let t=0;t<nPost;t++){
    const ramp = Math.min(1, t/130);
    post.push(pre[pre.length-1] + ramp*avgBps + (Math.random()-0.5)*1.5);
  }
  return {pre, post};
}

// Core mapping from toggles → outputs (mock logic consistent with econ story)
function computeOutputs(){
  // 1) Pre & Post shares
  normalizeShares();
  const preHHI = hhi(["Standard B","ABSA","FNB","Nedbank","Fringe"].map(b=>state.shares[b]));

  // Merge ON banks collapse into a single "Merged" entity
  let postShares = [];
  let mergedShare = 0;
  ["Standard B","ABSA","FNB","Nedbank"].forEach(b => {
    if (state.mergingOn[b]) mergedShare += state.shares[b];
    else postShares.push(state.shares[b]);
  });
  if (mergedShare>0) postShares.unshift(mergedShare); // Merged first
  postShares.push(state.shares["Fringe"]);
  const postHHI = hhi(postShares);

  // 2) Average price impact (bps) — increasing in conduct, entry; decreasing in innov; larger with HHI delta; moderated by flex
  const dHHI = postHHI - preHHI;
  const baseBps = 2 + 0.02*dHHI; // each 100 ΔHHI ~ +2 bps
  const effect  = baseBps * (1 + 0.9*state.conduct) * (1 + 0.4*state.entry) * (1 - 0.5*state.innov) * (1 - 0.35*state.flex);
  const avgBps  = Math.max(0, effect);

  // 3) Pass-through + base substitution (show as outputs)
  const passThrough = clamp(0.35 + 0.4*state.conduct - 0.2*state.innov, 0.10, 0.95);
  const baseSub     = clamp(0.15 + 0.6*state.flex - 0.25*state.entry, 0.05, 0.85);

  // 4) Welfare (mn): Consumer ≈ -avgBps * demand scale; Producer (merged) +; Others may gain/lose via substitution; DWL small triangular approx
  const demandScale = 3.2; // R mn per 1 bps impact (illustrative)
  const cons = -avgBps * demandScale;
  const mergedPS = Math.max(0, 0.65*avgBps*demandScale * (mergedShare || 0.35));
  const rivalsPS = (baseSub>0.3 ? 0.15 : -0.10)*avgBps*demandScale; // net mixed effect
  const dwl = Math.max(0.0, 0.12*avgBps); // small
  const net = cons + mergedPS + rivalsPS - dwl;

  // 5) Badge text
  const badge = hhiBadge(preHHI, postHHI, state.jurisdiction);

  return {
    preHHI, postHHI, dHHI,
    avgBps: Number(avgBps.toFixed(1)),
    passThrough: Number(passThrough.toFixed(2)),
    baseSub: Number(baseSub.toFixed(2)),
    welfare: {
      consumer: Number(cons.toFixed(1)),
      merged:   Number(mergedPS.toFixed(1)),
      others:   Number(rivalsPS.toFixed(1)),
      dwl:      Number(dwl.toFixed(1)),
      net:      Number(net.toFixed(1)),
    },
    badge
  };
}

// --- Render merger setup rows ---
function renderBanks(){
  const grid = document.getElementById("bankGrid");
  grid.innerHTML = "";
  ["Standard B","ABSA","FNB","Nedbank"].forEach(name=>{
    const row = document.createElement("div"); row.className="bank-row";
    row.innerHTML = `
      <input class="toggle" type="checkbox" ${state.mergingOn[name]?"checked":""} data-bank="${name}">
      <div class="name">${name}</div>
      <div class="share">
        <input type="range" min="0.05" max="0.60" step="0.01" value="${state.shares[name].toFixed(2)}" data-bank="${name}">
        <div class="pct" id="pct-${name}">${pct(state.shares[name],0)}</div>
      </div>
    `;
    grid.appendChild(row);
  });
}

// --- Charts ---
let cdsChart, hhiChart, welfareChart;
const actualSeries = makeActualSeries();

function buildCharts(outputs){
  // CDS chart
  const vmm = makeVMMSeries(actualSeries, outputs.avgBps);
  const ctx1 = document.getElementById("cdsChart").getContext("2d");
  if (cdsChart) cdsChart.destroy();
  cdsChart = new Chart(ctx1, {
    type: 'line',
    data: {
      labels: [...Array(365).keys()].map(i=>`T-${365-i}`),
      datasets: [
        {label:"Actual (pre)", data: actualSeries, borderColor:"#9fb4ff", tension:0.2, pointRadius:0, borderWidth:2},
        {label:"VMM (pre)",   data: vmm.pre,      borderColor:"#58d0ff", tension:0.2, pointRadius:0, borderWidth:2},
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{labels:{color:"#cfd6e6"}}, tooltip:{mode:'index', intersect:false} },
      scales:{
        x:{ ticks:{ color:"#8ea0b8" }, grid:{ color:"#1b2130" } },
        y:{ ticks:{ color:"#8ea0b8" }, grid:{ color:"#1b2130" } }
      }
    }
  });
  // Append post as a second chart overlay (simple approach: extend x later)
  // To keep UI clean, we show post in the same chart by reusing labels shifted:
  const postLabels = [...Array(365).keys()].map(i=>`T+${i+1}`);
  cdsChart.data.labels = cdsChart.data.labels.concat(postLabels);
  cdsChart.data.datasets.push({
    label:"VMM (post)",
    data: new Array(365).fill(null).concat(vmm.post),
    borderColor:"#ff9f6e", tension:0.2, pointRadius:0, borderWidth:2
  });
  cdsChart.update();

  // HHI chart (pre vs post bar)
  const ctx2 = document.getElementById("hhiChart").getContext("2d");
  if (hhiChart) hhiChart.destroy();
  hhiChart = new Chart(ctx2, {
    type:'bar',
    data:{
      labels:["Pre","Post"],
      datasets:[{
        data:[outputs.preHHI, outputs.postHHI],
        backgroundColor:["#58d0ff","#ff9f6e"]
      }]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}},
      scales:{
        x:{ ticks:{ color:"#cfd6e6" }, grid:{ color:"#1b2130" } },
        y:{ ticks:{ color:"#8ea0b8" }, grid:{ color:"#1b2130" } }
      }
    }
  });

  // Welfare chart (4 bars) with compact values
  const ctx3 = document.getElementById("welfareChart").getContext("2d");
  if (welfareChart) welfareChart.destroy();
  welfareChart = new Chart(ctx3, {
    type:'bar',
    data:{
      labels:["Consumer","Merged","Others","DWL"],
      datasets:[{
        data:[outputs.welfare.consumer, outputs.welfare.merged, outputs.welfare.others, outputs.welfare.dwl],
        backgroundColor:["#ff7b7b","#5ad39f","#9fb4ff","#ffc851"]
      }]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{callbacks:{
        label:(ctx)=> `${ctx.raw>0?'+':''}${fm(ctx.raw)}`
      }}},
      scales:{
        x:{ ticks:{ color:"#cfd6e6" }, grid:{ color:"#1b2130" } },
        y:{ ticks:{ color:"#8ea0b8" }, grid:{ color:"#1b2130" } }
      }
    }
  });
}

// --- Repaint all UI from state ---
function repaint(){
  const out = computeOutputs();

  document.getElementById("avgPriceBps").textContent = f1(out.avgBps);
  document.getElementById("hhiChange").textContent = out.dHHI;
  document.getElementById("hhiPre").textContent    = out.preHHI;
  document.getElementById("hhiPost").textContent   = out.postHHI;
  document.getElementById("hhiBadge").textContent  = out.badge;
  document.getElementById("passThrough").textContent = f2(out.passThrough);
  document.getElementById("baseSub").textContent     = f2(out.baseSub);
  document.getElementById("netWelfare").textContent  = (out.welfare.net>0?'+':'') + fm(out.welfare.net);

  // Update percent labels
  ["Standard B","ABSA","FNB","Nedbank"].forEach(b=>{
    const el = document.getElementById(`pct-${b}`);
    if (el) el.textContent = pct(state.shares[b],0);
  });

  // Takeout sentence
  const jurTxt = state.jurisdiction;
  const take = `Under current settings (${jurTxt}), the model estimates an average CDS premium increase of ${f1(out.avgBps)} bps, `
    + `HHI change ${out.dHHI} (Pre ${out.preHHI} → Post ${out.postHHI}, ${out.badge}), `
    + `consumer surplus ${out.welfare.consumer>0?'+':''}${fm(out.welfare.consumer)} mn, merged producers ${out.welfare.merged>0?'+':''}${fm(out.welfare.merged)} mn, `
    + `others ${out.welfare.others>0?'+':''}${fm(out.welfare.others)} mn, DWL ${fm(out.welfare.dwl)} mn; Net welfare ${out.welfare.net>0?'+':''}${fm(out.welfare.net)} mn.`;
  document.getElementById("takeout").textContent = take;

  buildCharts(out);
}

// --- Event wiring ---
function wire(){
  // Jurisdiction toggle
  document.querySelectorAll('.seg button').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('.seg button').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      state.jurisdiction = btn.dataset.jur;
      repaint();
    });
  });

  // Reset
  document.getElementById("resetBtn").addEventListener('click', ()=>{
    state = JSON.parse(JSON.stringify(DEFAULT));
    renderBanks(); wireBankControls();
    document.getElementById('conduct').value = state.conduct; document.getElementById('conductVal').textContent = `(${state.conduct.toFixed(2)})`;
    document.getElementById('flex').value    = state.flex;    document.getElementById('flexVal').textContent    = `(${state.flex.toFixed(2)})`;
    document.getElementById('entry').value   = state.entry;   document.getElementById('entryVal').textContent   = `(${state.entry.toFixed(2)})`;
    document.getElementById('innov').value   = state.innov;   document.getElementById('innovVal').textContent   = `(${state.innov.toFixed(2)})`;
    document.querySelectorAll('.seg button').forEach(b=>b.classList.remove('active'));
    document.querySelector(`.seg button[data-jur="${state.jurisdiction}"]`).classList.add('active');
    repaint();
  });

  // AI/Tech sliders
  const bind = (id, key, label) => {
    const el = document.getElementById(id);
    const lab = document.getElementById(label);
    el.addEventListener('input', ()=>{
      state[key] = parseFloat(el.value);
      lab.textContent = `(${state[key].toFixed(2)})`;
      repaint();
    });
  };
  bind('conduct','conduct','conductVal');
  bind('flex','flex','flexVal');
  bind('entry','entry','entryVal');
  bind('innov','innov','innovVal');
}

function wireBankControls(){
  // ON/OFF toggles
  document.querySelectorAll('.bank-row .toggle').forEach(chk=>{
    chk.addEventListener('change', ()=>{
      state.mergingOn[chk.dataset.bank] = chk.checked;
      repaint();
    });
  });
  // Sliders
  document.querySelectorAll('.bank-row input[type="range"]').forEach(sl=>{
    sl.addEventListener('input', ()=>{
      const b = sl.dataset.bank;
      state.shares[b] = parseFloat(sl.value);
      normalizeShares();
      renderBanks(); wireBankControls(); // re-render to refresh pct labels smoothly
      repaint();
    });
  });
}

// --- Boot ---
renderBanks();
wireBankControls();
wire();
repaint();
