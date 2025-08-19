#!/usr/bin/env python3
"""
Demo script for contestability-aware risk scoring
"""

from ui.formatting import EU, risk_level2

def demo_contestability_effects():
    print("=== Contestability-Aware Risk Scoring Demo ===\n")
    
    # Base scenario: moderate concentration increase
    hhi_pre, hhi_post = 2000, 2350  # ΔHHI = 350
    pt = 0.6  # moderate pass-through
    
    print(f"Base scenario: HHI {hhi_pre} → {hhi_post} (Δ{hhi_post-hhi_pre}), PT={pt}")
    
    # Test different contestability scenarios
    scenarios = [
        ("Low contestability", {"flex": 0.1, "entry": 0.9, "innov": 0.9}),
        ("Medium contestability", {"flex": 0.5, "entry": 0.5, "innov": 1.0}),
        ("High contestability", {"flex": 0.9, "entry": 0.1, "innov": 1.3}),
    ]
    
    for name, params in scenarios:
        risk = risk_level2(
            hhi_pre, hhi_post,
            pt=pt,
            flex=params["flex"],
            entry=params["entry"],
            innov=params["innov"],
            TH=EU.to_dict()
        )
        print(f"{name:20} → Risk: {risk}")
    
    print("\n=== Pass-through Effects ===\n")
    
    # Test different pass-through levels
    pt_scenarios = [0.2, 0.4, 0.6, 0.8, 1.0]
    for pt in pt_scenarios:
        risk = risk_level2(
            hhi_pre, hhi_post,
            pt=pt,
            flex=0.5,  # medium contestability
            entry=0.5,
            innov=1.0,
            TH=EU.to_dict()
        )
        print(f"Pass-through {pt:.1f} → Risk: {risk}")

if __name__ == "__main__":
    demo_contestability_effects()
