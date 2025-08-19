# Merger VMM Demo

## Overview

This project is an interactive simulation dashboard for analyzing the competitive effects of mergers in concentrated industries. It combines a FastAPI backend for robust econometric and structural model computations with a reactive UI for scenario testing and visualization.

Users can:
- Configure different merger scenarios (selecting banks/firms and market shares)
- Adjust economic assumptions (conduct, market breadth, entry barriers, innovation multipliers)
- View impacts on concentration (HHI), pass-through, pricing, and stakeholder welfare
- Visualize time-series projections of market outcomes (e.g., CDS premiums)

All results are deterministic, reproducible, and logged to a database for audit and calibration.

---

## What is the VMM?

VMM stands for Virtual Merger Model.

Instead of relying solely on historical data or reduced-form econometric estimates, the VMM uses a simulation-based structural approach:
- Market structure is represented by firms' market shares and competition parameters.
- A calibrated demand-supply framework generates counterfactual post-merger outcomes.
- Shocks are introduced with controlled randomness (seeded RNG) to produce realistic ranges.

The output includes:
- Average price/credit spread impacts (basis points)
- Concentration changes (ΔHHI)
- Pass-through estimates
- Stakeholder welfare effects (consumers, merging firms, rivals, deadweight loss)
- Projected dynamics of market outcomes over time

---

## Why VMM Improves on Standard Econometric Estimates

Traditional merger assessments often rely on:
- Before/after event studies, which can be confounded by external shocks.
- Reduced-form regressions, which assume linearity and require large datasets.

By contrast, the VMM provides:
- **Structural counterfactuals**: Simulated outcomes under different merger configurations, not just extrapolations from past data.
- **Granular scenario testing**: Users can stress-test assumptions (entry barriers, innovation, conduct) to see how results vary.
- **Deterministic reproducibility**: Each scenario has a stable outcome that can be audited.
- **Policy relevance**: Risk assessments are mapped to competition authority thresholds (EU/SA).

This makes the VMM especially useful for competition economists, regulators, and practitioners who need robust, scenario-based evidence rather than single-point econometric estimates.

---

## Technical Components
- **Backend**: FastAPI with endpoints for metrics, calibration, and logging (SQLite).
- **Frontend**: HTML/CSS/JS dashboard powered by Chart.js, fully reactive to backend API results.
- **Database**: Local SQLite store for calibration runs and scenario histories.
- **Deterministic Simulation**: Seeded RNG ensures reproducibility across runs.

---

## Running the Project

### Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8000
```

### Frontend
```bash
cd ui-rbb-mock
python -m http.server 8080
# Open http://localhost:8080 in browser
```

---

## Example Output
- ΔHHI: 280 (Pre 3069 → Post 3349)
- Pass-through: 0.46×
- Net Welfare: –R 0.1bn
- Risk Badge: High (EU thresholds)

---

## Next Steps
- Add richer calibration from external datasets
- Explore ML-driven parameter estimation for pass-through
- Extend to multiple jurisdictions (US, UK, Africa)
- Deploy on Netlify + hosted backend