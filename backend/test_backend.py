from fastapi.testclient import TestClient
from app import app

client = TestClient(app)

def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json().get("ok") is True

def test_metrics_basic():
    payload = {
        "banks":[
            {"name":"Standard","selected":True,"share":0.32},
            {"name":"ABSA","selected":True,"share":0.23},
            {"name":"FNB","selected":False,"share":0.25},
            {"name":"Nedbank","selected":False,"share":0.20}
        ],
        "params":{"conduct":0.35,"flex":0.40,"entry":0.60,"innov":1.00},
        "policy":"EU",
        "seed":123456
    }
    r = client.post("/metrics", json=payload)
    assert r.status_code == 200
    data = r.json()
    # single source of truth present
    assert "hhi" in data and "welfare" in data and "series" in data
    # stable seed means months array should be 25 long
    assert len(data["series"]["months"]) == 25

def test_normalization_round_trip():
    payload = {
        "banks":[
            {"name":"Standard","selected":True,"share":0.45},
            {"name":"ABSA","selected":True,"share":0.35},
            {"name":"FNB","selected":True,"share":0.35},
            {"name":"Nedbank","selected":True,"share":0.30},
        ],
        "params":{"conduct":0.3,"flex":0.4,"entry":0.6,"innov":1.0},
        "policy":"EU",
        "seed":123
    }
    r = client.post("/metrics", json=payload)
    assert r.status_code == 200
    data = r.json()
    
    # Check normalization worked
    total = sum(data["structure"]["inside"]) + data["structure"]["fringe"]
    assert abs(total - 1.0) < 1e-9, f"Total should be 1.0, got {total}"
    assert data["structure"]["fringe"] >= data["structure"]["fringe_floor"], f"Fringe should be >= floor, got {data['structure']['fringe']} vs {data['structure']['fringe_floor']}"
    assert data["hhi"]["pre"] > 0 and data["hhi"]["post"] > 0, "HHI should be positive"

def test_normalize_shares_respects_floor():
    from app import normalize_shares
    F_min = 0.30
    r = [0.45, 0.35, 0.35, 0.30]  # absurd raw, > 100%
    out = normalize_shares(r, F_min)
    inside, F = out["inside"], out["fringe"]
    assert abs(sum(inside) + F - 1.0) < 1e-9
    assert F >= F_min - 1e-9

def test_dynamic_fringe_widens_with_flex_entry_innov():
    from app import dynamic_fringe_floor
    low = dynamic_fringe_floor(flex=0.1, entry=0.9, innov=0.8)
    high = dynamic_fringe_floor(flex=0.9, entry=0.1, innov=1.2)
    assert high > low
