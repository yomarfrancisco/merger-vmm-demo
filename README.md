# Merger VMM Prototype (RBB Style)

## Run locally

### Backend (FastAPI)
```bash
cd backend
python -m venv .venv && source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

### Frontend (Static)
```bash
cd ui-rbb-mock
python -m http.server 8080
# open http://localhost:8080
```

## Notes
- Deterministic seeded series (reproducible runs)
- Confidence ribbon around VMM line
- EU/SA policy thresholds toggle
- Single metrics source-of-truth from backend
- SQLite logging (if implemented in backend)

## Deploy (optional)
- Frontend: Netlify/Vercel (static ui-rbb-mock/)
- Backend: Fly.io/Render/Heroku (FastAPI)