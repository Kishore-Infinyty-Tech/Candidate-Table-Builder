"""HTTP API: tracker parsing, resume extraction, table building, Excel export."""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from typing import Any, Literal

import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _core import build, excel, gemini, tracker, usage  # noqa: E402


def _load_env_file() -> None:
    """Load ../.env for local runs. On Vercel the variables come from project settings."""
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_env_file()

MAX_PARALLEL = int(os.environ.get("EXTRACT_PARALLEL", "5"))

app = FastAPI(title="Candidate Table Builder", docs_url="/api/docs", openapi_url="/api/openapi.json")


# ------------------------------------------------------------------ models


class ResumeIn(BaseModel):
    id: str
    filename: str
    mode: Literal["text", "file"]
    text: str | None = None
    file_b64: str | None = None
    mime_type: str = "application/pdf"


class ExtractRequest(BaseModel):
    resumes: list[ResumeIn] = Field(..., max_length=20)


class ResumeResult(BaseModel):
    id: str
    filename: str
    file_stem: str = ""
    mode: str | None = None
    text: str | None = None
    data: dict[str, Any] | None = None
    error: str | None = None


class TrackerData(BaseModel):
    headers: list[str]
    rows: list[list[str]]


class BuildRequest(BaseModel):
    resumes: list[ResumeResult]
    tracker: TrackerData
    mapping: dict[str, int | None]


class ExportRow(BaseModel):
    values: dict[str, str]
    highlight: bool = False


class ExportRequest(BaseModel):
    columns: list[str]
    rows: list[ExportRow]


# ------------------------------------------------------------------ routes


@app.get("/api/usage")
def gemini_usage() -> dict[str, Any]:
    return usage.summary(gemini._models())


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "model": gemini._model(),
        "key_configured": bool(os.environ.get("GEMINI_API_KEY")),
    }


@app.post("/api/tracker")
async def parse_tracker(file: UploadFile = File(...)) -> dict[str, Any]:
    name = (file.filename or "").lower()
    if not name.endswith((".xlsx", ".xlsm")):
        raise HTTPException(400, "Tracker must be an .xlsx Excel file.")
    data = await file.read()
    try:
        return tracker.read_tracker(data)
    except Exception as exc:  # bad / corrupt workbook
        raise HTTPException(400, f"Could not read the tracker: {exc}") from exc


@app.post("/api/extract")
async def extract(req: ExtractRequest) -> dict[str, Any]:
    sem = asyncio.Semaphore(MAX_PARALLEL)

    async def one(client: httpx.AsyncClient, item: ResumeIn) -> dict[str, Any]:
        async with sem:
            try:
                data = await gemini.extract_resume(
                    client,
                    text=item.text if item.mode == "text" else None,
                    file_b64=item.file_b64 if item.mode == "file" else None,
                    mime_type=item.mime_type,
                )
                return {"id": item.id, "data": data, "error": None}
            except gemini.ExtractionError as exc:
                return {"id": item.id, "data": None, "error": str(exc)}

    async with httpx.AsyncClient() as client:
        results = await asyncio.gather(*(one(client, r) for r in req.resumes))
    return {"results": results}


@app.post("/api/build")
def build_table(req: BuildRequest) -> dict[str, Any]:
    resumes = [r.model_dump() for r in req.resumes]
    return build.build_table(resumes, req.tracker.model_dump(), req.mapping)


@app.post("/api/export")
def export(req: ExportRequest) -> Response:
    content = excel.build_workbook(req.columns, [r.model_dump() for r in req.rows])
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="candidates.xlsx"'},
    )


# Local runs: serve the built dashboard from the same server (on Vercel the
# dashboard is served as static files instead).
_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if _DIST.is_dir():
    from fastapi.staticfiles import StaticFiles

    app.mount("/", StaticFiles(directory=_DIST, html=True), name="dashboard")
