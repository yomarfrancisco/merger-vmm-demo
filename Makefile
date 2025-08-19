.PHONY: api ui all
api:
	cd backend && uvicorn app:app --reload --host $${UVICORN_HOST:-0.0.0.0} --port $${UVICORN_PORT:-8000}
ui:
	cd ui-rbb-mock && python -m http.server 8080
all:
	make -j2 api ui
