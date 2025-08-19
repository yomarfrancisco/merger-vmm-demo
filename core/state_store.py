import datetime as dt
import numpy as np
import pandas as pd
from dataclasses import dataclass, asdict

BANKS = ["StdBank","ABSA","FNB","Nedbank"]

@dataclass
class Scenario:
    merger_members: tuple          # e.g., ("StdBank","FNB")
    shares: dict                   # bank -> share in % summing to ~100
    conduct: float                 # 0..1
    demand_flex: float             # 0..1 (market breadth)
    entry_barriers: float          # 0..1
    innovation_mult: float         # 0..1
    policy: str                    # "EU" or "South Africa"
    merger_date: pd.Timestamp

BASE_SHARES = {"StdBank": 0.43, "ABSA": 0.31, "FNB": 0.16, "Nedbank": 0.10}

def baseline_scenario() -> Scenario:
    md = pd.Timestamp.today().normalize() - pd.offsets.Day(365//2)  # center-ish
    return Scenario(
        merger_members=("StdBank","FNB"),
        shares=BASE_SHARES.copy(),
        conduct=0.35,
        demand_flex=0.45,
        entry_barriers=0.40,
        innovation_mult=0.30,
        policy="EU",
        merger_date=md
    )

def simulate_cds_series(scn: Scenario, days_pre=365, days_post=365, seed=7):
    """Simulate daily CDS (bps) + structural drift around merger date."""
    rng = np.random.default_rng(seed)
    dates = pd.date_range(scn.merger_date - pd.Timedelta(days=days_pre-1),
                          scn.merger_date + pd.Timedelta(days=days_post), freq="D")
    level0 = 130 + 5*rng.normal(size=len(dates)).cumsum()/np.sqrt(len(dates))
    # merger effect scales with ΔHHI-like signal from shares & conduct
    weights = np.array([scn.shares[b] for b in ["StdBank","ABSA","FNB","Nedbank"]])
    hhi_like = int((10000 * (weights**2).sum()))
    d_effect = (hhi_like/10000) * (0.3 + 0.7*scn.conduct) * (0.6 + 0.4*scn.entry_barriers)
    jump = 6.0 * d_effect  # bps jump spread
    series = level0.copy()
    series[dates >= scn.merger_date] += jump
    df = pd.DataFrame({"date": dates, "cds_actual": series})
    # Hide actual post-merger (as in real use)
    df.loc[df["date"] > scn.merger_date, "cds_actual"] = np.nan
    return df
