#!/usr/bin/env python3
"""
Test script to verify FastAPI backend integration
"""

import requests
import json

def test_backend():
    base_url = "http://localhost:8000"
    
    # Test calibration endpoint
    print("Testing calibration endpoint...")
    cal_response = requests.post(f"{base_url}/calibrate", 
                               json={"seed": 123456})
    print(f"Status: {cal_response.status_code}")
    print(f"Response: {cal_response.json()}")
    print()
    
    # Test metrics endpoint
    print("Testing metrics endpoint...")
    metrics_request = {
        "banks": [
            {"name": "Standard", "selected": True, "share": 0.32},
            {"name": "ABSA", "selected": True, "share": 0.23},
            {"name": "FNB", "selected": False, "share": 0.25},
            {"name": "Nedbank", "selected": False, "share": 0.20}
        ],
        "params": {
            "conduct": 0.35,
            "flex": 0.40,
            "entry": 0.60,
            "innov": 1.00
        },
        "policy": "EU",
        "seed": 123456
    }
    
    metrics_response = requests.post(f"{base_url}/metrics", 
                                   json=metrics_request)
    print(f"Status: {metrics_response.status_code}")
    
    if metrics_response.status_code == 200:
        metrics = metrics_response.json()
        print("✅ Backend working correctly!")
        print(f"Risk: {metrics['risk']}")
        print(f"BPS Impact: {metrics['bpsImpact']}")
        print(f"Net Welfare: {metrics['welfare']['net']}")
        print(f"Seed: {metrics['diag']['seed']}")
        print(f"Pre-merger VMM distinct: {metrics['series']['vmm'][0] != metrics['series']['actual'][0]}")
    else:
        print("❌ Backend error!")
        print(metrics_response.text)

if __name__ == "__main__":
    test_backend()
