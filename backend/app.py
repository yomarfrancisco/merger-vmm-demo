from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any
import numpy as np
import json
# from db import log_calibration_run, log_scenario_run

app = FastAPI(title="VMM Merger Simulation API")

# CORS middleware for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify actual origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic models
class Bank(BaseModel):
    name: str
    selected: bool
    share: float

class Params(BaseModel):
    conduct: float
    flex: float
    entry: float
    innov: float

class MetricsRequest(BaseModel):
    banks: List[Bank]
    params: Params
    policy: str
    seed: int

class CalibrateRequest(BaseModel):
    seed: int

# Policy thresholds for risk computation (matching frontend)
POLICY_THRESHOLDS = {
    "EU": {"deltaHigh": 150, "postHigh": 2500, "deltaMed": 100, "postMed": 2000},
    "SA": {"deltaHigh": 100, "postHigh": 2000, "deltaMed": 50,  "postMed": 1500}
}

def risk_level(pre_hhi: int, post_hhi: int, policy: str) -> str:
    TH = POLICY_THRESHOLDS.get(policy, POLICY_THRESHOLDS["EU"])
    delta = post_hhi - pre_hhi
    if delta >= TH["deltaHigh"] or post_hhi >= TH["postHigh"]:
        return "High"
    if delta >= TH["deltaMed"] or post_hhi >= TH["postMed"]:
        return "Medium"
    return "Low"

BREADTH_ALPHA = 0.30

def dynamic_fringe_floor(flex: float, entry: float, innov: float) -> float:
    """Return fringe floor in [0.10, 0.50] as function of params."""
    base     = 0.20                               # 20% baseline
    breadth  = 0.15 * flex                        # + up to 15% when market is broad
    barriers = -0.10 * entry                      # - up to 10% when barriers are high
    innov_fx = 0.05 * (innov - 1.0)               # +/- up to 5% around 1.0

    f = base + breadth + barriers + innov_fx
    return min(0.50, max(0.10, f))               # clamp 10%..50%

def normalize_shares(raw_inside: list[float], F_min: float) -> dict:
    # raw_inside like [0.45, 0.35, 0.35, 0.30] if user drags sliders
    # 1) sanitize negatives
    r = [max(0.0, float(x)) for x in raw_inside]
    R = sum(r)
    if R <= 1e-12:
        # even split inside capacity if everything is zero
        C = 1.0 - F_min
        n = len(r)
        s = [C / n] * n
        F = 1.0 - sum(s)
    else:
        C = 1.0 - F_min
        scale = C / R
        s = [x * scale for x in r]
        F = 1.0 - sum(s)
        if F < F_min:  # numerical guard
            # pull proportionally from s to restore F_min
            deficit = F_min - F
            take = deficit
            S = sum(s)
            if S > 0:
                s = [max(0.0, si - take * (si / S)) for si in s]
            F = 1.0 - sum(s)

    # final tidy to 1.0
    total = sum(s) + F
    if abs(total - 1.0) > 1e-9:
        # push the tiny diff to fringe
        F += (1.0 - total)

    return {"inside": s, "fringe": F, "fringe_floor": F_min}

def hhi_from_components(shares):
    # shares in 0..1; HHI on 0..100 scale
    return int(round(sum((s*100.0)**2 for s in shares)))

def mulberry32(seed: int):
    """Seeded RNG for deterministic results"""
    def rng():
        nonlocal seed
        seed = (seed + 0x6D2B79F5) & 0xFFFFFFFF
        t = seed
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t ^= (t + ((t ^ (t >> 7)) * (t | 61))) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296
    return rng

def apply_market_breadth(inside: List[float], fringe: float, flex: float) -> Dict[str, List[float]]:
    """Apply market breadth (flex) to expand fringe and rescale inside"""
    inside_sum = sum(inside)
    reassign = BREADTH_ALPHA * flex * inside_sum
    scale = (inside_sum - reassign) / inside_sum if inside_sum > 0 else 1
    inside_adj = [s * scale for s in inside]
    fringe_adj = min(1, max(0, fringe + reassign))
    
    # Normalize to ensure total = 1
    total = sum(inside_adj) + fringe_adj
    norm = 1 / total if total > 0 else 1
    return {
        "inside": [s * norm for s in inside_adj],
        "fringe": fringe_adj * norm
    }

def compute_hhi(shares: List[float]) -> int:
    """Compute HHI as sum of squared market shares (percentage points)"""
    return round(sum((s * 100) ** 2 for s in shares))

def vmm_predict(banks: List[Bank], params: Params, seed: int, hhi_delta: int) -> Dict[str, Any]:
    """Generate VMM predictions with seeded RNG"""
    rand = mulberry32(seed)
    
    # Generate months labels
    months = [f"{i-12}" if i-12 < 0 else f"+{i-12}" if i-12 > 0 else "M" 
              for i in range(25)]
    
    # Generate actual pre-merger data (months -12 to -1)
    actual = []
    base_value = 150
    for i in range(25):
        if i < 12:
            noise = (rand() - 0.5) * 10
            actual.append(base_value + noise)
        else:
            actual.append(None)  # No actual data post-merger
    
    # Calculate bps impact using new model
    bps_impact = (2.0 + 0.02*hhi_delta) * (1 + 0.5*params.conduct) * (1 + 0.3*params.entry) * (1 - 0.2*params.innov)
    
    # Generate VMM estimate
    vmm = []
    for i in range(25):
        if i < 12:
            actual_value = actual[i] or base_value
            smoothing = (rand() - 0.5) * 2  # Small deterministic offset
            vmm.append(actual_value + smoothing)
        else:
            # Post-merger projection with actual bps impact
            months_post_merger = i - 11  # 1, 2, 3, etc.
            impact_factor = min(months_post_merger / 6.0, 1.0)  # Gradual ramp-up over 6 months
            drift = bps_impact * impact_factor
            noise = (rand() - 0.5) * 5
            vmm.append(base_value + drift + noise)
    
    # Generate confidence band (wider for post-merger projections)
    conf_band = {
        "lower": [],
        "upper": []
    }
    
    for i, v in enumerate(vmm):
        if i < 12:
            # Pre-merger: tight band
            conf_band["lower"].append(v - 3)
            conf_band["upper"].append(v + 3)
        else:
            # Post-merger: wider band due to uncertainty
            conf_band["lower"].append(v - 6)
            conf_band["upper"].append(v + 6)
    
    return {
        "bps_impact": bps_impact,
        "pass_through": 0.3 + 0.4 * params.conduct + 0.2 * params.entry - 0.1 * params.flex,
        "conf_band": conf_band,
        "series": {
            "actual": actual,
            "vmm": vmm
        }
    }



def compute_welfare(bps: float, pass_through: float, conduct: float, entry: float, innov: float):
    """
    Units: bps mapped to R bn (illustrative). Choose the 'k' to fit your narrative.
    """
    k = 1.0/15.0  # +15 bps ≈ R1bn consumer effect (same scale you used before)
    # Consumer loses only the passed-through share of price increase
    cons = - pass_through * bps * k

    # Efficiency channel (innovation & entry reduce harm / raise producer surplus)
    # Tunable alpha/beta/gamma so we can see positive net cases.
    alpha = 0.70  # weight of innovation
    beta  = 0.40  # weight of entry
    gamma = 0.30  # conduct dampens efficiencies if high
    efficiency = max(0.0, alpha*(innov-1.0) + beta*entry - gamma*conduct)

    # Producer (merged) gain: (1 - pass_through)*bps + efficiency kicker
    merged = (1.0 - pass_through) * bps * k * 0.6 + efficiency

    # Non-merging banks: small gain if pass_through high (they ride the price),
    # small loss if pass_through low (competition / share erosion)
    rivals = (0.10 if pass_through >= 0.5 else -0.05) * bps * k

    # Deadweight loss ∝ pass_through * bps but *reduced* by efficiencies
    dwl_base = 0.50 * pass_through * bps * k
    deadweight = - max(0.0, dwl_base * (1.0 - 0.6*min(1.0, efficiency)))  # negative = loss

    net = cons + merged + rivals + deadweight
    return dict(cons=round(cons,3), merged=round(merged,3),
                rivals=round(rivals,3), deadweight=round(deadweight,3),
                net=round(net,3))



@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"ok": True}

@app.post("/metrics")
async def compute_metrics(request: MetricsRequest):
    """Compute all metrics for a merger scenario"""
    
    # Extract raw inside shares from request
    raw_inside = [b.share for b in request.banks]
    
    # Calculate dynamic fringe floor
    f_floor = dynamic_fringe_floor(request.params.flex, request.params.entry, request.params.innov)
    
    # Normalize shares with single function
    norm_result = normalize_shares(raw_inside, f_floor)
    inside_shares = norm_result["inside"]
    fringe = norm_result["fringe"]
    
    # Create normalized bank objects with selected flags
    banks_norm = []
    for i, b in enumerate(request.banks):
        banks_norm.append({
            "name": b.name,
            "share": inside_shares[i],
            "selected": b.selected
        })
    
    # Unit checks
    total = sum(inside_shares) + fringe
    assert abs(total - 1.0) < 1e-9, f"Total should be 1.0, got {total}"
    assert fringe >= f_floor - 1e-9, f"Fringe {fringe} should be >= floor {f_floor}"
    print(f"DEBUG: fringe_floor={f_floor:.3f}, fringe={fringe:.3f}, total={total:.6f}")
    
    # Apply market breadth to normalized shares
    breadth_result = apply_market_breadth(inside_shares, fringe, request.params.flex)
    inside_adj = breadth_result["inside"]
    fringe_adj = breadth_result["fringe"]
    
    # Compute pre-merger HHI from normalized components
    pre_components = inside_shares + [fringe]
    hhi_pre = hhi_from_components(pre_components)
    
    # Compute post-merger HHI: combine selected into one, keep rivals + fringe
    selected = [b for b in banks_norm if b.get('selected')]
    merged_share = sum(b['share'] for b in selected)
    rivals = [b['share'] for b in banks_norm if not b.get('selected')]
    post_components = [merged_share] + rivals + [fringe]
    hhi_post = hhi_from_components(post_components)
    
    hhi_delta = hhi_post - hhi_pre
    
    # Debug logging
    print(f"DEBUG: hhi_pre={hhi_pre}, hhi_post={hhi_post}, delta={hhi_delta}, selected_banks={[b['name'] for b in banks_norm if b.get('selected')]}")
    
    # Get VMM predictions
    vmm_result = vmm_predict(request.banks, request.params, request.seed, hhi_delta)
    
    # Compute pass-through and bps impact
    pass_through = 0.3 + 0.4*request.params.conduct + 0.2*request.params.entry - 0.1*request.params.flex
    pass_through = max(0.05, min(0.95, pass_through))
    
    # Example bps mapping, tune slope to your data
    bps = (2.0 + 0.02*hhi_delta) * (1 + 0.5*request.params.conduct) * (1 + 0.3*request.params.entry) * (1 - 0.2*request.params.innov)
    
    welfare = compute_welfare(bps, pass_through, request.params.conduct, request.params.entry, request.params.innov)
    risk = risk_level(hhi_pre, hhi_post, request.policy)
    
    # Prepare response with normalized shares and fringe
    response = {
        "hhi": {
            "pre": hhi_pre,
            "post": hhi_post,
            "delta": hhi_delta
        },
        "bpsImpact": round(bps, 1),
        "passThrough": round(pass_through, 2),
        "welfare": welfare,
        "policy": request.policy,
        "risk": risk,
        "params": {
            "conduct": request.params.conduct,
            "flex": request.params.flex,
            "entry": request.params.entry,
            "innov": request.params.innov
        },
        "series": {
            "months": [f"{i-12}" if i-12 < 0 else f"+{i-12}" if i-12 > 0 else "M" for i in range(25)],
            "actual": vmm_result["series"]["actual"],
            "vmm": vmm_result["series"]["vmm"],
            "band": vmm_result["conf_band"]
        },
        "diag": {
            "shares_sum": round(sum(inside_adj) + fringe_adj, 3),
            "tolerance_ok": abs(sum(inside_adj) + fringe_adj - 1.0) < 0.001,
            "seed": request.seed
        },
        "structure": {
            "inside": inside_shares,
            "fringe": fringe,
            "fringe_floor": f_floor
        }
    }
    
    # Log the run
    # log_scenario_run(request.policy, request.model_dump(), response)
    
    return response

@app.post("/calibrate")
async def calibrate(request: CalibrateRequest):
    """Calibrate the model (stub implementation)"""
    
    # Mock hyperparameters
    hyperparams = {
        "elasticity": 0.85,
        "market_power": 0.42,
        "entry_barrier": 0.38,
        "innovation_factor": 1.12
    }
    
    response = {
        "seed": request.seed,
        "hyperparams": hyperparams,
        "status": "calibrated"
    }
    
    # Log the calibration
    # log_calibration_run(request.seed, {"seed": request.seed}, response)
    
    return response

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
