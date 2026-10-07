"""Resume fact extraction through the Gemini REST API.

Gemini only extracts raw facts (names, dates, degrees). All formatting and
calculations happen in code so the output stays consistent.
"""

from __future__ import annotations

import asyncio
import time
import json
import os
import random
import re
from typing import Any

import httpx

from . import usage

API_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
DEFAULT_MODEL = "gemini-3.8-flash"
# Each model has its own free daily quota, so falling back extends the daily capacity.
DEFAULT_FALLBACKS = "gemini-3.5-flash,gemini-3.1-flash-lite,gemini-3.5-flash-lite"
REQUEST_TIMEOUT = 120.0
MAX_ATTEMPTS = 2  # per model
RETRYABLE = (429, 500, 502, 503, 504)
# Vercel's free plan stops a request after 300 s, so each resume gets a time
# budget there; locally there is no such limit.
DEADLINE_SECONDS = float(os.environ.get("EXTRACT_DEADLINE_SECONDS") or (240 if os.environ.get("VERCEL") else 600))

PROMPT = """You are reading ONE candidate resume. Extract facts exactly as written.

Rules:
- Copy values from the resume. Never guess, infer or invent anything.
- If a value is not written in the resume, return null (or an empty list).
- name: the candidate's full name as written.
- phones / emails: every phone number and email address of the candidate.
- stated_total_experience: the exact phrase where the candidate states their TOTAL
  professional experience (e.g. "3+ years of experience", "around 5 years").
  Ignore experience stated for a single skill or tool. null if not stated.
- education: every degree/diploma/schooling entry.
  level: phd | masters | bachelors | diploma | school | other
  (MBA, M.Tech, M.Sc, MS, MCA, PGDM = masters; B.Tech, BE, B.Sc, BCA, BBA, B.Com = bachelors).
  degree: short degree name (e.g. "B.Tech", "B.E", "MBA", "M.Sc", "MCA"), without the branch.
  branch: specialisation / stream only if written (e.g. "Computer Science"), else null.
  institute: college or university name only if written, else null. Name only -
  leave out city, state, country and pin code.
  year: 4-digit completion / graduation year only if written, else null.
  If only a range is given (2016 - 2020), year is the end year.
- experience: every job, internship or role, in the order they appear in the resume.
  When one company lists several roles/promotions, return one entry per role.
  company: employer name only, as written - leave out city, state, country and
  "Remote" (if working via a vendor/payroll for a client,
  use the employer the candidate is on the payroll of, as written first).
  title: job title as written.
  start_month / end_month: 1-12 only if a month is written, else null.
  start_year / end_year: 4-digit year only if written, else null.
  is_current: true when the role is ongoing ("Present", "Current", "Till date").
  is_internship: true for internships / trainee programmes.
  is_client_project: false for a job with an employer. true ONLY for a client,
  project or assignment listed underneath an employer job (e.g. an IT services
  employee placed at Sony / SiriusXM, or "Client - XYZ"). Always also return the
  employer job itself as its own entry, with the designation held at the employer
  and the employer's full dates. A client name mentioned inside an employer entry
  never replaces the employer name.
  Freelance work and jobs the resume presents as the candidate's own employer are
  NOT client projects, even when their dates overlap other jobs.
"""

SCHEMA: dict[str, Any] = {
    "type": "OBJECT",
    "properties": {
        "name": {"type": "STRING", "nullable": True},
        "phones": {"type": "ARRAY", "items": {"type": "STRING"}},
        "emails": {"type": "ARRAY", "items": {"type": "STRING"}},
        "stated_total_experience": {"type": "STRING", "nullable": True},
        "education": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "level": {
                        "type": "STRING",
                        "enum": ["phd", "masters", "bachelors", "diploma", "school", "other"],
                    },
                    "degree": {"type": "STRING", "nullable": True},
                    "branch": {"type": "STRING", "nullable": True},
                    "institute": {"type": "STRING", "nullable": True},
                    "year": {"type": "STRING", "nullable": True},
                },
                "required": ["level", "degree", "branch", "institute", "year"],
            },
        },
        "experience": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "company": {"type": "STRING"},
                    "title": {"type": "STRING", "nullable": True},
                    "start_month": {"type": "INTEGER", "nullable": True},
                    "start_year": {"type": "INTEGER", "nullable": True},
                    "end_month": {"type": "INTEGER", "nullable": True},
                    "end_year": {"type": "INTEGER", "nullable": True},
                    "is_current": {"type": "BOOLEAN"},
                    "is_internship": {"type": "BOOLEAN"},
                    "is_client_project": {"type": "BOOLEAN"},
                },
                "required": [
                    "company", "title", "start_month", "start_year",
                    "end_month", "end_year", "is_current", "is_internship",
                    "is_client_project",
                ],
            },
        },
    },
    "required": ["name", "phones", "emails", "stated_total_experience", "education", "experience"],
}


class ExtractionError(Exception):
    pass


def _api_key() -> str:
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        raise ExtractionError("GEMINI_API_KEY is not set on the server.")
    return key


def _model() -> str:
    return os.environ.get("GEMINI_MODEL", "").strip() or DEFAULT_MODEL


def _models() -> list[str]:
    fallbacks = os.environ.get("GEMINI_FALLBACK_MODELS", DEFAULT_FALLBACKS)
    models = [_model()] + [m.strip() for m in fallbacks.split(",") if m.strip()]
    return list(dict.fromkeys(models))


def _daily_quota_used_up(resp: httpx.Response) -> tuple[bool, int | None]:
    """Free tier has a per-model daily request cap; waiting will not help.
    Returns (used up?, the daily limit Google quotes)."""
    try:
        for detail in resp.json().get("error", {}).get("details", []):
            for violation in detail.get("violations", []):
                if "PerDay" in str(violation.get("quotaId", "")):
                    value = str(violation.get("quotaValue", ""))
                    return True, int(value) if value.isdigit() else None
    except Exception:
        pass
    return False, None


def _retry_delay(resp: httpx.Response, attempt: int) -> float:
    """Honour Gemini's suggested retry delay on 429, else exponential backoff."""
    try:
        for detail in resp.json().get("error", {}).get("details", []):
            delay = detail.get("retryDelay")
            if delay:
                return min(float(str(delay).rstrip("s")), 30.0) + 1
    except Exception:
        pass
    return 2 ** attempt + random.random()


async def extract_resume(
    client: httpx.AsyncClient,
    *,
    text: str | None = None,
    file_b64: str | None = None,
    mime_type: str = "application/pdf",
) -> dict[str, Any]:
    if not text and not file_b64:
        raise ExtractionError("Nothing to read in this file.")

    parts: list[dict[str, Any]] = []
    if file_b64:
        parts.append({"inline_data": {"mime_type": mime_type, "data": file_b64}})
    else:
        parts.append({"text": "RESUME TEXT:\n" + text})
    parts.append({"text": PROMPT})

    body = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "temperature": 0,
            "responseMimeType": "application/json",
            "responseSchema": SCHEMA,
        },
    }
    headers = {"x-goog-api-key": _api_key(), "Content-Type": "application/json"}

    # Try the main model first; if it stays overloaded, move to the fallback models.
    last_error = "Daily free Gemini limit reached on all models. Try again after the daily reset."
    used_up_today = usage.exhausted_models()
    deadline = time.monotonic() + DEADLINE_SECONDS
    for model in _models():
        if model in used_up_today:
            continue  # Google already said this model is done for today
        url = API_URL.format(model=model)
        for attempt in range(MAX_ATTEMPTS):
            remaining = deadline - time.monotonic()
            if remaining < 5:
                raise ExtractionError(f"Gemini is slow right now and this resume timed out ({last_error}). Please run it again.")
            try:
                resp = await client.post(url, headers=headers, json=body, timeout=min(REQUEST_TIMEOUT, remaining))
            except httpx.HTTPError as exc:
                last_error = f"Network problem reaching Gemini ({type(exc).__name__}). Check the internet connection."
                await asyncio.sleep(min(2 ** attempt + random.random(), max(0, deadline - time.monotonic() - 5)))
                continue

            if resp.status_code == 200:
                data = _parse_response(resp.json())
                data["_model"] = model
                usage.record_success(model)
                return data

            try:
                message = resp.json().get("error", {}).get("message", resp.text)
            except Exception:
                message = resp.text
            last_error = f"Gemini error {resp.status_code}: {message.splitlines()[0][:300]}"
            daily_used_up, daily_limit = _daily_quota_used_up(resp) if resp.status_code == 429 else (False, None)
            if daily_used_up:
                usage.record_exhausted(model, daily_limit)
                last_error = "Daily free Gemini limit reached on all models. Try again after the daily reset."
                break  # this model is done for today, move to the next one
            if resp.status_code in RETRYABLE:
                await asyncio.sleep(min(_retry_delay(resp, attempt), max(0, deadline - time.monotonic() - 5)))
                continue
            if resp.status_code == 404:
                break  # model not available on this key, try the next one
            raise ExtractionError(last_error)

    raise ExtractionError(last_error)


def _parse_response(payload: dict[str, Any]) -> dict[str, Any]:
    candidates = payload.get("candidates") or []
    if not candidates:
        reason = payload.get("promptFeedback", {}).get("blockReason", "no answer")
        raise ExtractionError(f"Gemini returned no result ({reason}).")
    parts = candidates[0].get("content", {}).get("parts", [])
    raw = "".join(p.get("text", "") for p in parts).strip()
    raw = re.sub(r"^```(?:json)?|```$", "", raw).strip()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ExtractionError("Gemini returned unreadable data.") from exc
    if not isinstance(data, dict):
        raise ExtractionError("Gemini returned unexpected data.")
    data.setdefault("phones", [])
    data.setdefault("emails", [])
    data.setdefault("education", [])
    data.setdefault("experience", [])
    return data
