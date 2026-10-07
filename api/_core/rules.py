"""Formatting rules for every output column.

Each function turns raw tracker values or raw resume facts into the exact
text that goes into the client table.
"""

from __future__ import annotations

import math
import re
from datetime import date
from typing import Any

from rapidfuzz import fuzz

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
EN_DASH = "–"

EMPTY_VALUES = {"", "na", "n/a", "nil", "no", "none", "null", "-", "--", "0", "nope", "not applicable"}

# ---------------------------------------------------------------- text helpers


def clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def is_empty(value: Any) -> bool:
    return clean(value).lower().strip(".") in EMPTY_VALUES


def smart_title(name: str) -> str:
    """Title-case names written fully in upper or lower case; keep mixed case."""
    name = clean(name)
    if not name:
        return name
    if name.isupper() or name.islower():
        return " ".join(w if len(w) <= 2 and w.isupper() else w.capitalize() for w in name.split(" "))
    return name


def normalize_name(name: str) -> str:
    name = clean(name).lower()
    name = re.sub(r"[^a-z ]", " ", name)
    return re.sub(r"\s+", " ", name).strip()


def name_similarity(a: str, b: str) -> float:
    a, b = normalize_name(a), normalize_name(b)
    if not a or not b:
        return 0.0
    # "Shalini TR" vs "Shalini T R": also compare with spaces removed.
    return max(fuzz.token_sort_ratio(a, b), fuzz.ratio(a.replace(" ", ""), b.replace(" ", "")))


# ---------------------------------------------------------------- phone / email


def normalize_phone(value: Any) -> str:
    """Return the digits of an Indian number without +91 / leading 0."""
    digits = re.sub(r"\D", "", str(value or ""))
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    return digits


def is_valid_phone(digits: str) -> bool:
    return len(digits) == 10 and digits[0] in "6789"


def phones_from_text(value: Any) -> list[str]:
    """A tracker cell may hold several numbers separated by , / or spaces."""
    parts = re.split(r"[,/;|]|\s{2,}", str(value or ""))
    out = [normalize_phone(p) for p in parts]
    return [p for p in out if p]


def normalize_email(value: Any) -> str:
    return re.sub(r"\s+", "", str(value or "")).lower().strip(".,;")


# ---------------------------------------------------------------- CTC


def _lpa(value: str) -> str:
    """Add the unit when the tracker holds a bare number (e.g. '12' -> '12 Lpa')."""
    value = clean(value)
    if re.fullmatch(r"\d+(\.\d+)?(\s*-\s*\d+(\.\d+)?)?", value):
        return f"{value} Lpa"
    return value


def format_current_ctc(current: Any, variable: Any) -> str:
    current = _lpa(clean(current))
    variable = clean(variable)
    # "Yes, 2 Lpa" -> "2 Lpa"
    variable = re.sub(r"^(yes|y)\s*[,:-]?\s*", "", variable, flags=re.I)
    if not current:
        return ""
    if is_empty(variable):
        return f"{current} (All Fixed)"
    return f"{current} (Fixed) + {_lpa(variable)} (Variable)"


# ---------------------------------------------------------------- notice / offer

_LWD = re.compile(r"\bLWD\b\s*[:\-]?\s*[^;|]*;?", re.I)


def format_offer(offer: Any) -> str:
    text = _LWD.sub("", str(offer or ""))
    text = clean(text).strip(" ;,|")
    text = re.sub(r"\s*;\s*", "; ", text)
    if is_empty(text) or re.fullmatch(r"no\s*offers?\.?", text, re.I):
        return "No Offers"
    return re.sub(r"\b(an?\s+offer)\s+of\s+", r"\1 ", text, flags=re.I)


def format_notice_offer(notice: Any, offer: Any) -> str:
    notice = clean(notice)
    offer_text = format_offer(offer)
    if not notice:
        return offer_text
    return f"{notice} | {offer_text}"


# ---------------------------------------------------------------- education

LEVEL_RANK = {"phd": 5, "masters": 4, "bachelors": 3, "diploma": 2, "other": 1, "school": 0}


def _year_num(value: Any) -> int:
    m = re.search(r"(19|20)\d{2}", str(value or ""))
    return int(m.group(0)) if m else 0


def highest_education(entries: list[dict[str, Any]]) -> dict[str, Any] | None:
    usable = [e for e in entries or [] if clean(e.get("degree")) or clean(e.get("institute"))]
    if not usable:
        return None
    return max(usable, key=lambda e: (LEVEL_RANK.get(e.get("level") or "other", 1), _year_num(e.get("year"))))


_DEGREE_SHORT = [
    (r"bachelor\s+of\s+technology", "B.Tech"),
    (r"bachelor\s+of\s+engineering", "B.E"),
    (r"bachelor\s+of\s+science", "B.Sc"),
    (r"bachelor\s+of\s+computer\s+applications?", "BCA"),
    (r"bachelor\s+of\s+business\s+administration", "BBA"),
    (r"bachelor\s+of\s+commerce", "B.Com"),
    (r"master\s+of\s+technology", "M.Tech"),
    (r"master\s+of\s+engineering", "M.E"),
    (r"master\s+of\s+science", "M.Sc"),
    (r"master\s+of\s+computer\s+applications?", "MCA"),
    (r"master\s+of\s+business\s+administration", "MBA"),
    (r"doctor\s+of\s+philosophy", "PhD"),
    # Short forms written without dots.
    (r"^b\.?\s*tech\.?$", "B.Tech"),
    (r"^m\.?\s*tech\.?$", "M.Tech"),
    (r"^b\.?\s*e\.?$", "B.E"),
    (r"^m\.?\s*e\.?$", "M.E"),
    (r"^b\.?\s*sc\.?$", "B.Sc"),
    (r"^m\.?\s*sc\.?$", "M.Sc"),
]

_INDIAN_STATES = (
    "andhra pradesh|arunachal pradesh|assam|bihar|chhattisgarh|goa|gujarat|haryana|himachal pradesh|"
    "jharkhand|karnataka|kerala|madhya pradesh|maharashtra|manipur|meghalaya|mizoram|nagaland|odisha|"
    "punjab|rajasthan|sikkim|tamil nadu|telangana|tripura|uttar pradesh|uttarakhand|west bengal|delhi|india"
)


def _shorten(text: str) -> str:
    out = clean(text)
    for pattern, short in _DEGREE_SHORT:
        out = re.sub(pattern, short, out, flags=re.I)
    return out


def _degree_key(text: str) -> str:
    return re.sub(r"[^a-z]", "", text.lower())


def short_degree(degree: str) -> str:
    """'Master of Technology (M.Tech)' -> 'M.Tech'; 'Bachelor of Engineering – BE' -> 'B.E'."""
    out = _shorten(degree)
    m = re.fullmatch(r"(.+?)\s*(?:\((.+)\)|[–—-]\s*(.+))", out)
    if m:
        main, alt = m.group(1), m.group(2) or m.group(3)
        if _degree_key(_shorten(alt)) == _degree_key(main):
            out = main
    return out.strip()


def strip_location(institute: str) -> str:
    """'X Institute of Technology, Nidasoshi, Karnataka' -> 'X Institute of Technology'."""
    parts = [p.strip() for p in clean(institute).split(",")]
    if len(parts) > 1 and re.fullmatch(rf"({_INDIAN_STATES})(\s*-?\s*\d{{6}})?", parts[-1], re.I):
        parts = parts[:-1]
        # The part before a state is the town.
        if len(parts) > 1 and len(parts[-1].split()) <= 2:
            parts = parts[:-1]
    return ", ".join(parts)


def format_education(entry: dict[str, Any] | None) -> str:
    if not entry:
        return ""
    degree = short_degree(entry.get("degree"))
    branch = clean(entry.get("branch"))
    institute = strip_location(entry.get("institute"))
    year = _year_num(entry.get("year"))

    head = degree
    if branch and branch.lower() not in degree.lower():
        head = f"{degree} - {branch}" if degree else branch
    text = ", ".join(p for p in (head, institute) if p)
    if year:
        text = f"{text} ({year})" if text else str(year)
    return text


# ---------------------------------------------------------------- experience


def _month_index(year: Any, month: Any) -> int | None:
    if not year:
        return None
    try:
        y = int(year)
    except (TypeError, ValueError):
        return None
    m = month if isinstance(month, int) and 1 <= month <= 12 else None
    return y * 12 + ((m or 1) - 1)


def _today_index(today: date) -> int:
    return today.year * 12 + today.month - 1


def role_span(role: dict[str, Any], today: date) -> tuple[int, int] | None:
    """Half-open month interval [start, end) for one role, or None if undated."""
    start = _month_index(role.get("start_year"), role.get("start_month"))
    if start is None:
        return None
    if role.get("is_current"):
        end = _today_index(today)
    else:
        end_idx = _month_index(role.get("end_year"), role.get("end_month"))
        if end_idx is None:
            return None
        end = end_idx + 1
    if end <= start:
        return None
    return start, end


def total_months(roles: list[dict[str, Any]], today: date) -> int | None:
    """Merge overlapping roles and skip gaps between jobs."""
    spans = sorted(s for s in (role_span(r, today) for r in roles or []) if s)
    if not spans:
        return None
    merged: list[list[int]] = []
    for start, end in spans:
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return sum(end - start for start, end in merged)


def years_label(whole: int, plus: bool) -> str:
    unit = "Year" if whole == 1 and not plus else "Years"
    return f"{whole}+ {unit}" if plus else f"{whole} {unit}"


def parse_years_text(text: Any) -> tuple[str, float] | None:
    """'3+ years' -> ('3+ Years', 3.5); '4.2 Years' -> ('4+ Years', 4.2);
    '9 Months' -> ('0+ Years', 0.75). Returns None when no figure is found."""
    text = clean(text).lower()
    if not text:
        return None
    m = re.search(r"(\d+(?:\.\d+)?)\s*(\+)?\s*(?:years?|yrs?)", text)
    if m:
        value = float(m.group(1))
        whole = int(math.floor(value))
        plus = bool(m.group(2)) or value > whole
        return years_label(whole, plus), value + (0.5 if m.group(2) else 0)
    m = re.search(r"(\d+)\s*(?:months?|mos?)", text)
    if m:
        months = int(m.group(1))
        return years_label(months // 12, months % 12 > 0), months / 12
    return None


def months_label(months: int) -> tuple[str, float]:
    return years_label(months // 12, months % 12 > 0), months / 12


# ---------------------------------------------------------------- companies

_COMPANY_NOISE = re.compile(
    r"\b(pvt|private|ltd|limited|inc|incorporated|llp|llc|corp|corporation|co|company|"
    r"technologies|technology|solutions|services|india|global|the)\b"
)


def employer_roles(roles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Drop client projects listed under an employer job (e.g. TCS -> Sony).
    If every entry is flagged, the flags are unreliable, so keep them all."""
    roles = list(roles or [])
    employers = [r for r in roles if not r.get("is_client_project")]
    return employers or roles


def company_key(name: str) -> str:
    key = re.sub(r"[^a-z0-9 ]", " ", clean(name).lower())
    key = _COMPANY_NOISE.sub(" ", key)
    return re.sub(r"\s+", " ", key).strip() or clean(name).lower()


def same_company(a: str, b: str) -> bool:
    ka, kb = company_key(a), company_key(b)
    return ka == kb or fuzz.ratio(ka, kb) >= 90


def _fmt_month(year: Any, month: Any) -> str:
    if not year:
        return ""
    if isinstance(month, int) and 1 <= month <= 12:
        return f"{MONTHS[month - 1]} {year}"
    return str(year)


def _role_sort_key(role: dict[str, Any], today: date) -> int:
    if role.get("is_current"):
        return _today_index(today) + 1
    idx = _month_index(role.get("end_year"), role.get("end_month") or 12)
    if idx is None:
        idx = _month_index(role.get("start_year"), role.get("start_month")) or 0
    return idx


def _start_key(role: dict[str, Any]) -> int:
    return _month_index(role.get("start_year"), role.get("start_month")) or 0


def order_roles(roles: list[dict[str, Any]], today: date) -> list[dict[str, Any]]:
    """Most recent first. If any role is undated, keep the resume's own order."""
    roles = [r for r in employer_roles(roles) if clean(r.get("company"))]
    if any(not r.get("start_year") for r in roles):
        return roles
    return sorted(roles, key=lambda r: (_role_sort_key(r, today), _start_key(r)), reverse=True)


def _range_text(roles: list[dict[str, Any]]) -> str:
    """Date range covering a list of roles (newest first)."""
    oldest = min(roles, key=_start_key)
    start = _fmt_month(oldest.get("start_year"), oldest.get("start_month"))
    newest = roles[0]
    if any(r.get("is_current") for r in roles):
        end = "Present"
    else:
        end = _fmt_month(newest.get("end_year"), newest.get("end_month"))
    if start and end:
        return f"{start} {EN_DASH} {end}"
    return start or end


_PLACES = (
    _INDIAN_STATES + "|mumbai|bangalore|bengaluru|pune|hyderabad|chennai|new delhi|noida|gurgaon|gurugram|"
    "kolkata|ahmedabad|jaipur|kochi|cochin|indore|nagpur|thane|navi mumbai|coimbatore|chandigarh|lucknow|"
    "mysore|mysuru|vadodara|trivandrum|thiruvananthapuram|bhubaneswar|remote|usa|united states|uk|"
    "united kingdom|ireland|dublin|london|singapore|dubai|uae|canada|australia|germany"
)
_TRAILING_PLACE = re.compile(rf"(,\s*({_PLACES}))+\s*$", re.I)


def clean_company(name: str) -> str:
    """Drop a trailing location ('X Pvt Ltd, Mumbai') and a stray trailing full
    stop ('Solutions.') but keep 'Pvt. Ltd.' / 'Inc.'."""
    name = clean(name).strip(" ,;")
    stripped = _TRAILING_PLACE.sub("", name).strip(" ,;")
    if stripped:
        name = stripped
    if name.endswith(".") and len(name.rstrip(".").split(" ")[-1]) > 4:
        name = name.rstrip(".")
    return name


def _line(company: str, title: str, dates: str) -> str:
    text = clean_company(company)
    if clean(title):
        text += f" {EN_DASH} {clean(title)}"
    if dates:
        text += f" | {dates}"
    return text


def format_companies(roles: list[dict[str, Any]], today: date, limit: int = 3) -> str:
    """Last `limit` distinct companies. When the candidate has fewer companies
    than `limit`, the remaining lines are filled with individual roles."""
    ordered = order_roles(roles, today)
    if not ordered:
        return ""

    # Group consecutive roles at the same employer (a re-join counts separately).
    groups: list[list[dict[str, Any]]] = []
    for role in ordered:
        if groups and same_company(groups[-1][0]["company"], role["company"]):
            groups[-1].append(role)
        else:
            groups.append([role])

    groups = groups[:limit]
    # Every company gets one line; spare lines split the most recent companies into roles.
    lines_per_group = [1] * len(groups)
    spare = limit - len(groups)
    for i, group in enumerate(groups):
        if spare <= 0:
            break
        extra = min(spare, len(group) - 1)
        lines_per_group[i] += extra
        spare -= extra

    lines: list[str] = []
    for group, n_lines in zip(groups, lines_per_group):
        company = group[0]["company"]
        if n_lines == 1:
            lines.append(_line(company, group[0].get("title"), _range_text(group)))
            continue
        for role in group[: n_lines - 1]:
            lines.append(_line(company, role.get("title"), _range_text([role])))
        rest = group[n_lines - 1 :]
        lines.append(_line(company, rest[0].get("title"), _range_text(rest)))

    return "\n".join(f"{i}. {line}" for i, line in enumerate(lines, 1))
