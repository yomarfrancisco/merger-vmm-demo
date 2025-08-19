from dataclasses import dataclass

def fmt_bps(x: float) -> str:
    return f"{x:+.0f} bps"

def fmt_hhi(x: int) -> str:
    return f"{x:,}"

def fmt_hhi_card(pre: int, post: int) -> str:
    delta = post - pre
    sign = "+" if delta >= 0 else ""
    return f"{sign}{delta:,} ΔHHI  |  {pre:,} → {post:,}"

def fmt_rbn(x: float) -> str:
    return f"{x:.2f} R bn"

@dataclass
class Thresholds:
    warn_hhi_post: int
    warn_hhi_delta: int
    
    def to_dict(self):
        return {
            "deltaHigh": self.warn_hhi_delta,
            "postHigh": self.warn_hhi_post,
            "deltaMed": self.warn_hhi_delta,
            "postMed": self.warn_hhi_post
        }

# Illustrative policy thresholds
EU = Thresholds(warn_hhi_post=2000, warn_hhi_delta=150)
SA = Thresholds(warn_hhi_post=2000, warn_hhi_delta=150)

def risk_level(hhi_pre: int, hhi_post: int, th: Thresholds) -> str:
    d = hhi_post - hhi_pre
    if hhi_post >= th.warn_hhi_post and d >= th.warn_hhi_delta:
        return "High"
    if hhi_post >= th.warn_hhi_post or d >= th.warn_hhi_delta:
        return "Medium"
    return "Low"

# --- contestability-aware risk scoring ---

def _clamp(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))

def risk_level2(hhi_pre: int, hhi_post: int, *, pt: float, flex: float, entry: float, innov: float, TH) -> str:
    """
    Contestability-aware risk classification.
    Inputs:
      - hhi_pre, hhi_post: ints
      - pt: pass-through (0..~1+)
      - flex: 'market breadth' / demand flexibility (0..1)
      - entry: entry barriers (0..1, higher = worse)
      - innov: innovation multiplier (~0.8..1.5; >1 reduces risk)
      - TH: dict of thresholds like EU/SA {deltaHigh, postHigh, deltaMed, postMed}
    Returns: 'Low' | 'Medium' | 'High'
    """
    delta = max(0, int(hhi_post) - int(hhi_pre))

    # 1) Baseline structural signal (normalized to policy "high" thresholds)
    base = 0.6 * (delta / max(1, TH["deltaHigh"])) + 0.4 * (hhi_post / max(1, TH["postHigh"]))

    # 2) Harm amplification by pass-through (pt≈0..1 -> multiplier ~0.7..1.3)
    amp_pt = 0.7 + 0.6 * _clamp(pt, 0.0, 1.5)

    # 3) Contestability mitigation (flex ↑, entry ↓, innov ↑)
    innov_adj = _clamp((innov - 1.0) / 0.5)  # 1.0->0, 1.5->1 (cap at 1)
    mitigation = _clamp(0.50 * _clamp(flex) + 0.30 * _clamp(1.0 - entry) + 0.20 * innov_adj, 0.0, 0.75)

    idx = base * amp_pt * (1.0 - mitigation)

    # Debug logging (optional - can be removed in production)
    print(f"RISK_DEBUG: base={base:.3f}, amp_pt={amp_pt:.3f}, mitigation={mitigation:.3f}, idx={idx:.3f}")

    if idx >= 1.0:
        return "High"
    if idx >= 0.60:
        return "Medium"
    return "Low"
