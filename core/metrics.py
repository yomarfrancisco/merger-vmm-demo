import numpy as np

def hhi_from_shares(shares: dict) -> int:
    # shares are fractions summing to ~1
    return int(10000 * sum((s)**2 for s in shares.values()))

def hhi_post_merge(shares: dict, merger_members: tuple) -> int:
    merged = sum(shares[m] for m in merger_members)
    rest = {k:v for k,v in shares.items() if k not in merger_members}
    merged_dict = {"Merged": merged, **rest}
    return hhi_from_shares(merged_dict)

def pass_through(conduct: float, demand_flex: float, entry_barriers: float) -> float:
    # stylized composite (0.3..1.2×)
    base = 0.5 + 0.7*conduct
    breadth = 0.8 - 0.4*demand_flex
    frictions = 0.7 + 0.6*entry_barriers
    return max(0.3, min(1.2, base * breadth * frictions))

def base_substitution_label(demand_flex: float) -> str:
    if demand_flex < 0.33: return "Low"
    if demand_flex < 0.66: return "Medium"
    return "High"

def welfare_decomposition(avg_bps: float, pass_th: float, innovation_mult: float):
    # toy welfare: convert bps to R bn impacts and allocate
    # negative for consumers, positive for producers; DWL grows with conduct-ish proxy
    cons = -0.53 * (avg_bps/100.0) * (1.0)         # scale knob
    merged = 0.40 * (avg_bps/100.0) * (0.8 + 0.4*innovation_mult)
    others = 0.12 * (avg_bps/100.0) * pass_th
    dwl = -0.05 * (avg_bps/100.0) * (0.6 + 0.4*pass_th)
    return cons, merged, others, dwl  # R bn
