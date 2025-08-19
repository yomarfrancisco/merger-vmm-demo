from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any
import numpy as np
import json
from db import log_calibration_run, log_scenario_run

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

# Banking-calibrated thresholds for realistic risk variation
BANKING_THRESHOLDS = {
    # Tuned for typical concentrated banking markets so we actually see variation
    "EU": {"post_med": 3000, "post_high": 3600, "dmed": 500, "dhigh": 1000},
    "SA": {"post_med": 2800, "post_high": 3400, "dmed": 400, "dhigh": 900},
}

def risk_level(hhi_pre: int, hhi_post: int, policy: str, conduct: float, pass_through: float) -> str:
    Δ = hhi_post - hhi_pre
    t = BANKING_THRESHOLDS.get(policy, BANKING_THRESHOLDS["EU"])
    # base level from structure
    if hhi_post >= t["post_high"] or Δ >= t["dhigh"]:
        level = "High"
    elif hhi_post >= t["post_med"] or Δ >= t["dmed"]:
        level = "Medium"
    else:
        level = "Low"
    # behavior adjustment (rule-of-reason flavor)
    # • very competitive conduct + low pass-through → soften one notch
    # • collusive conduct + high pass-through → harden one notch
    soften = (conduct <= 0.25 and pass_through <= 0.40)
    harden = (conduct >= 0.75 and pass_through >= 0.60)
    if level == "High" and soften: level = "Medium"
    elif level == "Medium" and soften: level = "Low"
    elif level == "Low" and harden: level = "Medium"
    elif level == "Medium" and harden: level = "High"
    return level

BREADTH_ALPHA = 0.30
FRINGE_MIN = 0.20

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
    
    # Extract bank data
    bank_shares = {bank.name: bank.share for bank in request.banks}
    selected_banks = [bank.name for bank in request.banks if bank.selected]
    
    # Get inside shares and compute fringe
    inside_shares = [bank.share for bank in request.banks]
    fringe = max(FRINGE_MIN, 1 - sum(inside_shares))
    
    # Apply market breadth
    breadth_result = apply_market_breadth(inside_shares, fringe, request.params.flex)
    inside_adj = breadth_result["inside"]
    fringe_adj = breadth_result["fringe"]
    
    # Compute pre-merger HHI
    pre_shares = inside_adj + [fringe_adj]
    hhi_pre = compute_hhi(pre_shares)
    
    # Compute post-merger HHI
    merged_share = sum(inside_adj[i] for i, bank in enumerate(request.banks) if bank.selected)
    rival_shares = [inside_adj[i] for i, bank in enumerate(request.banks) if not bank.selected]
    post_shares = [merged_share] + rival_shares + [fringe_adj]
    hhi_post = compute_hhi(post_shares)
    
    hhi_delta = hhi_post - hhi_pre
    
    # Debug logging
    print(f"DEBUG: hhi_pre={hhi_pre}, hhi_post={hhi_post}, delta={hhi_delta}, selected_banks={[b.name for b in request.banks if b.selected]}")
    
    # Get VMM predictions
    vmm_result = vmm_predict(request.banks, request.params, request.seed, hhi_delta)
    
    # Compute pass-through and bps impact
    pass_through = 0.3 + 0.4*request.params.conduct + 0.2*request.params.entry - 0.1*request.params.flex
    pass_through = max(0.05, min(0.95, pass_through))
    
    # Example bps mapping, tune slope to your data
    bps = (2.0 + 0.02*hhi_delta) * (1 + 0.5*request.params.conduct) * (1 + 0.3*request.params.entry) * (1 - 0.2*request.params.innov)
    
    welfare = compute_welfare(bps, pass_through, request.params.conduct, request.params.entry, request.params.innov)
    risk = risk_level(hhi_pre, hhi_post, request.policy, request.params.conduct, pass_through)
    
    # Prepare response
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
        }
    }
    
    # Log the run
    log_scenario_run(request.policy, request.model_dump(), response)
    
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
    log_calibration_run(request.seed, {"seed": request.seed}, response)
    
    return response

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
