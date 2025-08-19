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
