from ui.formatting import EU, risk_level2

def test_contestability_mitigates_risk():
    pre, post = 2000, 2350  # ΔHHI = 350, moderately high
    pt = 0.6

    low_contest = risk_level2(pre, post, pt=pt, flex=0.1, entry=0.9, innov=0.9, TH=EU.to_dict())
    high_contest = risk_level2(pre, post, pt=pt, flex=0.9, entry=0.1, innov=1.3, TH=EU.to_dict())

    # With strong contestability, label should weakly improve (or at least not get worse)
    assert low_contest in ("High", "Medium")
    assert high_contest in ("Medium", "Low")

def test_pass_through_amplifies_risk():
    pre, post = 2000, 2350  # ΔHHI = 350, moderately high
    
    low_pt = risk_level2(pre, post, pt=0.2, flex=0.5, entry=0.5, innov=1.0, TH=EU.to_dict())
    high_pt = risk_level2(pre, post, pt=0.8, flex=0.5, entry=0.5, innov=1.0, TH=EU.to_dict())
    
    # Higher pass-through should increase risk
    assert high_pt in ("High", "Medium")
    # Low pass-through might reduce risk
    assert low_pt in ("Medium", "Low")

def test_innovation_reduces_risk():
    pre, post = 2000, 2350  # ΔHHI = 350, moderately high
    pt = 0.6
    
    low_innov = risk_level2(pre, post, pt=pt, flex=0.5, entry=0.5, innov=0.8, TH=EU.to_dict())
    high_innov = risk_level2(pre, post, pt=pt, flex=0.5, entry=0.5, innov=1.3, TH=EU.to_dict())
    
    # Higher innovation should reduce risk
    assert high_innov in ("Medium", "Low")
    # Lower innovation might increase risk
    assert low_innov in ("High", "Medium")
