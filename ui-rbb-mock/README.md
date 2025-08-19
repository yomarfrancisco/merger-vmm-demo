# RBB-Style Merger Dashboard — Style Mock (Static)

**What this is:**  
A static, front-end–only mock of a professional dashboard (no data, no backend, no build).  
Open `index.html` in your browser to view.

**Design goals:**
- Executive summary one-liner at top
- Muted, professional RBB-style palette (blue/grey/ink)
- Minimal clutter; clean typography (Inter)
- Sidebar with "what-if" toggles (disabled, for layout only)
- KPI pills + two charts (CDS premiums over time, welfare)
- HHI panel and notes

**No functionality:**  
All numbers are placeholder. Sliders are disabled intentionally.

**How to run:**  
- Double-click `index.html` (or serve statically with any file server).

**Next steps (when wiring):**
- Replace placeholder arrays in `script.js` with real data.
- Connect toggles to your VMM engine and recompute outputs.
- Derive the one-liner headline from the recomputed results.


⸻

How this helps
	•	Pure style: looks like a professional RBB board, no runtime dependencies.
	•	Executive one-liner up top (what a judge/client reads first).
	•	Toggles present (but disabled) exactly where you'll want them when you wire the model.
	•	Outputs shown as outputs (pass-through, substitution, HHI, price impact, welfare).
	•	Consistent color/typography with a restrained, boardroom-ready aesthetic.
