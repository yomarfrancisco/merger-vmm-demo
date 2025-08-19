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
