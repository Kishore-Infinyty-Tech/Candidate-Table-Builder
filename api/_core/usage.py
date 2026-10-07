"""Approximate Gemini free-tier usage for the current quota day.

Google offers no API to read the remaining free quota, so the app counts its
own successful calls per model. When Google reports a model's daily limit is
used up, that model is marked exhausted and the limit Google quotes is saved,
so the numbers correct themselves.

Storage: a local JSON file by default. If UPSTASH_REDIS_REST_URL and
UPSTASH_REDIS_REST_TOKEN are set (deployed version), a free Upstash Redis
database is used instead so every user shares one counter.
"""

from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx

# Free-tier requests per day per model. Flash limits were read from Google's
# own quota errors; lite limits are a cautious guess until Google reports them.
DEFAULT_LIMITS = {
    "gemini-3.8-flash": 20,
    "gemini-3.5-flash": 20,
    "gemini-3.1-flash-lite": 20,
    "gemini-3.5-flash-lite": 20,
}

_LOCK = threading.Lock()
# Vercel's project folder is read-only; /tmp is writable but only lasts while
# the server instance stays warm (use Upstash there for a reliable count).
_FILE = Path("/tmp/.usage.json") if os.environ.get("VERCEL") else Path(__file__).resolve().parents[2] / ".usage.json"


# ------------------------------------------------------------- quota day


def _pacific_offset(utc_now: datetime) -> timedelta:
    """US Pacific is UTC-7 during daylight saving (2nd Sun Mar - 1st Sun Nov), else UTC-8."""
    year = utc_now.year

    def nth_sunday(month: int, n: int) -> datetime:
        first = datetime(year, month, 1, tzinfo=timezone.utc)
        days = (6 - first.weekday()) % 7
        return first + timedelta(days=days + 7 * (n - 1))

    dst_start = nth_sunday(3, 2) + timedelta(hours=10)  # 2am PST = 10:00 UTC
    dst_end = nth_sunday(11, 1) + timedelta(hours=9)    # 2am PDT = 09:00 UTC
    return timedelta(hours=-7) if dst_start <= utc_now < dst_end else timedelta(hours=-8)


def quota_day(now: datetime | None = None) -> tuple[str, datetime]:
    """(day key, next reset time in UTC). Quotas reset at midnight Pacific."""
    utc_now = now or datetime.now(timezone.utc)
    local = utc_now + _pacific_offset(utc_now)
    next_midnight_local = datetime(local.year, local.month, local.day, tzinfo=timezone.utc) + timedelta(days=1)
    reset_utc = next_midnight_local - _pacific_offset(next_midnight_local)
    return local.strftime("%Y-%m-%d"), reset_utc


# ------------------------------------------------------------- storage


class _FileStore:
    def load(self) -> dict[str, Any]:
        try:
            return json.loads(_FILE.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def save(self, data: dict[str, Any]) -> None:
        try:
            _FILE.write_text(json.dumps(data, indent=1), encoding="utf-8")
        except OSError:
            pass  # read-only disk: usage display is best effort


class _UpstashStore:
    KEY = "gemini-usage"

    def __init__(self, url: str, token: str):
        self.url = url.rstrip("/")
        self.headers = {"Authorization": f"Bearer {token}"}

    def load(self) -> dict[str, Any]:
        try:
            r = httpx.get(f"{self.url}/get/{self.KEY}", headers=self.headers, timeout=5)
            value = r.json().get("result")
            return json.loads(value) if value else {}
        except Exception:
            return {}

    def save(self, data: dict[str, Any]) -> None:
        try:
            httpx.post(f"{self.url}/set/{self.KEY}", headers=self.headers, content=json.dumps(data), timeout=5)
        except Exception:
            pass


def _store():
    url = os.environ.get("UPSTASH_REDIS_REST_URL", "").strip()
    token = os.environ.get("UPSTASH_REDIS_REST_TOKEN", "").strip()
    return _UpstashStore(url, token) if url and token else _FileStore()


def _env_limits() -> dict[str, int]:
    """Optional override: GEMINI_DAILY_LIMITS=gemini-3.1-flash-lite:500,..."""
    out: dict[str, int] = {}
    for part in os.environ.get("GEMINI_DAILY_LIMITS", "").split(","):
        name, _, value = part.partition(":")
        if name.strip() and value.strip().isdigit():
            out[name.strip()] = int(value)
    return out


def _today(data: dict[str, Any]) -> dict[str, Any]:
    day, _ = quota_day()
    if data.get("day") != day:
        data = {"day": day, "used": {}, "exhausted": [], "learned_limits": data.get("learned_limits", {})}
    data.setdefault("used", {})
    data.setdefault("exhausted", [])
    data.setdefault("learned_limits", {})
    return data


# ------------------------------------------------------------- public


def record_success(model: str) -> None:
    with _LOCK:
        store = _store()
        data = _today(store.load())
        data["used"][model] = data["used"].get(model, 0) + 1
        store.save(data)


def record_exhausted(model: str, limit: int | None) -> None:
    with _LOCK:
        store = _store()
        data = _today(store.load())
        if model not in data["exhausted"]:
            data["exhausted"].append(model)
        if limit:
            data["learned_limits"][model] = limit
        store.save(data)


def exhausted_models() -> set[str]:
    return set(_today(_store().load())["exhausted"])


def summary(models: list[str]) -> dict[str, Any]:
    data = _today(_store().load())
    _, reset_at = quota_day()
    overrides = _env_limits()
    rows = []
    for m in models:
        limit = overrides.get(m) or data["learned_limits"].get(m) or DEFAULT_LIMITS.get(m, 20)
        exhausted = m in data["exhausted"]
        used = limit if exhausted else min(data["used"].get(m, 0), limit)
        rows.append({
            "model": m,
            "used": used,
            "limit": limit,
            "exhausted": exhausted,
            "limit_confirmed": m in overrides or m in data["learned_limits"] or m in ("gemini-3.8-flash", "gemini-3.5-flash"),
        })
    total = sum(r["limit"] for r in rows)
    used = sum(r["used"] for r in rows)
    now = datetime.now(timezone.utc)
    return {
        "models": rows,
        "used": used,
        "limit": total,
        "remaining": max(0, total - used),
        "percent_used": round(100 * used / total) if total else 0,
        "resets_at": reset_at.isoformat(),
        "resets_in_seconds": max(0, int((reset_at - now).total_seconds())),
        "storage": "shared" if isinstance(_store(), _UpstashStore) else "local",
    }
