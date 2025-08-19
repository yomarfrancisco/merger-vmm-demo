
import streamlit as st
import pandas as pd
import numpy as np
import plotly.graph_objects as go
import plotly.express as px
from ui.formatting import EU, SA, fmt_bps, fmt_hhi_card, fmt_rbn, risk_level2
from core.state_store import baseline_scenario, simulate_cds_series, BANKS
from core.metrics import hhi_from_shares, hhi_post_merge, pass_through, base_substitution_label, welfare_decomposition
from core.vmm_model import fit_vmm_pre, predict_with_ci

st.set_page_config(page_title="Merger Simulation Dashboard", layout="wide")

# Custom CSS for styling
st.markdown("""
<style>
    .main-header {
        background: linear-gradient(90deg, #2c3e50, #34495e);
        padding: 1rem;
        border-radius: 8px;
        margin-bottom: 1rem;
    }
    .risk-badge {
        position: absolute;
        top: 12px;
        right: 16px;
        padding: 6px 10px;
        border-radius: 8px;
        color: white;
        font-weight: 600;
        font-size: 12px;
    }
    .risk-high { background: #c33; }
    .risk-medium { background: #a83; }
    .risk-low { background: #2a5; }
    .metric-card {
        background: #f8f9fa;
        padding: 1rem;
        border-radius: 8px;
        border-left: 4px solid #007bff;
    }
</style>
""", unsafe_allow_html=True)

# --- Header: Branding + Policy + Reset
left, mid, right = st.columns([3,2,2])
with left:
    st.markdown("""
    <div class="main-header">
        <h3 style='margin:0; color: white;'>RBB | Economics</h3>
        <div style='opacity:.8; color: white;'>Merger Simulation • South Africa • CDS</div>
    </div>
    """, unsafe_allow_html=True)
with mid:
    policy = st.selectbox("Policy Thresholds", ["EU", "South Africa"], index=0)
    TH = EU if policy == "EU" else SA
with right:
    if st.button("Reset to Baseline", type="primary"):
        st.experimental_rerun()

# --- Scenario panel
scn = baseline_scenario()
st.sidebar.header("Merger Setup")
sel = st.sidebar.multiselect("Select merging banks", BANKS, default=list(scn.merger_members))
if len(sel) < 2:
    st.sidebar.warning("Select ≥ 2 banks to merge.")
scn.merger_members = tuple(sel[:4])  # max 4

st.sidebar.markdown("**Market Shares**")
for b in BANKS:
    scn.shares[b] = st.sidebar.slider(b, 0, 100, int(scn.shares[b]*100)) / 100.0
# normalize
total = sum(scn.shares.values())
if total > 0:
    for b in BANKS:
        scn.shares[b] /= total

st.sidebar.header("AI Parameters")
scn.conduct = st.sidebar.slider("Conduct (0=competitive → 1=collusive)", 0.0, 1.0, scn.conduct, 0.01)
scn.demand_flex = st.sidebar.slider("Market breadth", 0.0, 1.0, scn.demand_flex, 0.01)

st.sidebar.header("Tech Parameters")
scn.entry_barriers = st.sidebar.slider("Entry Barriers", 0.0, 1.0, scn.entry_barriers, 0.01)
scn.innovation_mult = st.sidebar.slider("Innovation Multiplier", 0.0, 1.0, scn.innovation_mult, 0.01)

# --- Simulate data & VMM
df = simulate_cds_series(scn)
pre, yhat_pre, resid = fit_vmm_pre(df)
vmm_pred, vmm_lo, vmm_hi, fitstats = predict_with_ci(df, pre, yhat_pre, resid, boot_n=400)

df["vmm_pred"] = vmm_pred
df["vmm_lo"] = vmm_lo
df["vmm_hi"] = vmm_hi

# --- Metrics row
hhi_pre = hhi_from_shares(scn.shares)
hhi_post = hhi_post_merge(scn.shares, scn.merger_members)
pt = pass_through(scn.conduct, scn.demand_flex, scn.entry_barriers)
avg_bps_impact = float(np.nanmean(df.loc[df["date"] > scn.merger_date, "vmm_pred"] - df.loc[df["date"] > scn.merger_date, "vmm_lo"]))  # conservative
base_sub = base_substitution_label(scn.demand_flex)

m1, m2, m3, m4 = st.columns(4)
with m1: 
    st.markdown(f"""
    <div class="metric-card">
        <div style="font-size: 14px; color: #666;">Average Price Impact</div>
        <div style="font-size: 24px; font-weight: bold; color: #007bff;">{fmt_bps(avg_bps_impact)}</div>
    </div>
    """, unsafe_allow_html=True)
with m2: 
    st.markdown(f"""
    <div class="metric-card">
        <div style="font-size: 14px; color: #666;">Concentration Change</div>
        <div style="font-size: 18px; font-weight: bold; color: #007bff;">{fmt_hhi_card(hhi_pre, hhi_post)}</div>
    </div>
    """, unsafe_allow_html=True)
with m3: 
    st.markdown(f"""
    <div class="metric-card">
        <div style="font-size: 14px; color: #666;">Pass-Through</div>
        <div style="font-size: 24px; font-weight: bold; color: #007bff;">{pt:.2f}×</div>
    </div>
    """, unsafe_allow_html=True)
with m4: 
    st.markdown(f"""
    <div class="metric-card">
        <div style="font-size: 14px; color: #666;">Base Substitution</div>
        <div style="font-size: 24px; font-weight: bold; color: #007bff;">{base_sub}</div>
    </div>
    """, unsafe_allow_html=True)

# --- CDS chart (actual pre, VMM full, CI)
fig = go.Figure()
mask_pre = df["date"] <= scn.merger_date
fig.add_trace(go.Scatter(x=df.loc[mask_pre,"date"], y=df.loc[mask_pre,"cds_actual"],
                         mode="lines", name="Actual (pre)", line=dict(width=2, color="#5da3ff")))
fig.add_trace(go.Scatter(x=df["date"], y=df["vmm_pred"],
                         mode="lines", name="VMM Estimate", line=dict(width=2, dash="dot", color="#9be6c9")))
fig.add_trace(go.Scatter(x=pd.concat([df["date"], df["date"][::-1]]),
                         y=pd.concat([df["vmm_hi"], df["vmm_lo"][::-1]]),
                         fill="toself", fillcolor="rgba(100,150,255,0.15)",
                         line=dict(color="rgba(0,0,0,0)"),
                         hoverinfo="skip", name="95% CI"))

# Add merger date line
fig.add_shape(
    type="line",
    x0=scn.merger_date,
    x1=scn.merger_date,
    y0=0,
    y1=1,
    yref="paper",
    line=dict(color="red", width=2, dash="dash")
)

fig.add_annotation(
    x=scn.merger_date,
    y=1.02,
    yref="paper",
    text="Merger Date",
    showarrow=False,
    font=dict(color="red", size=12)
)

fig.update_layout(
    height=340, 
    margin=dict(l=10,r=10,t=10,b=0), 
    yaxis_title="CDS Premium (bps)",
    title="CDS Spreads: Actual vs VMM Counterfactual",
    showlegend=True,
    legend=dict(x=0.02, y=0.98)
)
st.plotly_chart(fig, use_container_width=True)

# --- Welfare bars + net
w_cons, w_merge, w_others, w_dwl = welfare_decomposition(avg_bps_impact, pt, scn.innovation_mult)
wdf = pd.DataFrame({
    "Stakeholder": ["Consumers", "Merged Entity", "Non-Merging Banks", "Deadweight Loss"],
    "Rbn": [w_cons, w_merge, w_others, w_dwl]
})

fig_w = px.bar(wdf, x="Stakeholder", y="Rbn", 
               color="Stakeholder",
               color_discrete_map={
                   "Consumers": "#ff6b6b",
                   "Merged Entity": "#4ecdc4", 
                   "Non-Merging Banks": "#45b7d1",
                   "Deadweight Loss": "#96ceb4"
               })

fig_w.update_traces(
    text=[fmt_rbn(x) for x in wdf["Rbn"]], 
    textposition="outside",
    textfont=dict(size=10)
)

fig_w.update_layout(
    height=320, 
    margin=dict(l=10,r=10,t=10,b=0), 
    yaxis_title="Welfare (R bn)",
    title="Welfare Decomposition",
    showlegend=False
)

st.plotly_chart(fig_w, use_container_width=True)

# Net welfare
net_welfare = sum(wdf["Rbn"])
net_color = "#28a745" if net_welfare >= 0 else "#dc3545"
st.markdown(f"""
<div style="text-align: center; padding: 1rem; background: #f8f9fa; border-radius: 8px; margin: 1rem 0;">
    <strong>Net welfare effect:</strong> <span style="color: {net_color}; font-size: 18px; font-weight: bold;">{fmt_rbn(net_welfare)}</span>
</div>
""", unsafe_allow_html=True)

# --- Risk badge
badge = risk_level2(
    hhi_pre, hhi_post,
    pt=pt,
    flex=scn.demand_flex,
    entry=scn.entry_barriers,
    innov=scn.innovation_mult,
    TH=TH.to_dict()
)
risk_class = f"risk-{badge.lower()}"
st.markdown(f"""
<div class="risk-badge {risk_class}">Overall Risk: {badge}</div>
""", unsafe_allow_html=True)

# --- Notes & disclaimer
st.info(
    f"**Policy:** {policy} thresholds. **VMM pre-fit:** R²={fitstats['R2']:.2f}, MAPE={fitstats['MAPE']:.1f}%, "
    f"mean resid={fitstats['mean_resid']:.1f} bps. CI via bootstrap (95%).\n\n"
    "**Disclaimer:** Prepared for discussion with **RBB Economics**. Illustrative data; not actual results."
)
