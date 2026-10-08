"""Intentionally minimal. The AI Race Engineer arrives in Phase 14 and will only tool-call
the APEX API (never providers directly), so it cannot fabricate telemetry."""
from fastapi import FastAPI

app = FastAPI(title="APEX F1 AI", version="0.0.1")

@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "apex-ai"}
