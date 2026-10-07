"""Match resumes to tracker rows and build the final table.

Matching is the step that must never put one candidate's CTC on another
candidate's row, so every pair is scored on phone, email and name, matched
one-to-one, and anything uncertain is flagged for review.
"""

from __future__ import annotations

from datetime import date
from typing import Any

from . import rules
from .tracker import row_value

COLUMNS = [
    "Name",
    "No. of Years of Experience",
    "Education (Highest)",
    "Companies (Last 3)",
    "Contact No",
    "Email id",
    "Current CTC (Fixed) + Any variable",
    "Expected CTC (Fixed)",
    "Notice Period/Offer status",
    "Recruiter_Comments",
]

NAME_STRONG = 85  # name alone is enough above this
NAME_WEAK = 60    # with a phone/email hit, names below this are suspicious

# --------------------------------------------------------------------- matching


def _resume_contacts(resume: dict[str, Any]) -> tuple[set[str], set[str]]:
    data = resume.get("data") or {}
    phones = {rules.normalize_phone(p) for p in data.get("phones") or []}
    emails = {rules.normalize_email(e) for e in data.get("emails") or []}
    return {p for p in phones if len(p) >= 8}, {e for e in emails if "@" in e}


def _phone_hit(resume_phones: set[str], tracker_cell: str) -> bool:
    for t in rules.phones_from_text(tracker_cell):
        if len(t) < 8:
            continue
        for r in resume_phones:
            # Exact, or tracker missing/adding a digit (e.g. 502353893 vs 9502353893).
            if t == r or (len(t) >= 9 and (r.endswith(t) or t.endswith(r))):
                return True
    return False


def score_pair(resume: dict[str, Any], row: list[str], mapping: dict[str, int | None]) -> dict[str, Any]:
    data = resume.get("data") or {}
    phones, emails = _resume_contacts(resume)
    tracker_name = row_value(row, mapping, "name")
    tracker_email = rules.normalize_email(row_value(row, mapping, "email"))

    phone = _phone_hit(phones, row_value(row, mapping, "phone"))
    email = bool(tracker_email) and tracker_email in emails
    name_sim = max(
        rules.name_similarity(data.get("name") or "", tracker_name),
        # Files are usually saved under the candidate's name.
        rules.name_similarity(resume.get("file_stem") or "", tracker_name),
    )
    return {
        "phone": phone,
        "email": email,
        "name": round(name_sim),
        "score": (100 if phone else 0) + (100 if email else 0) + name_sim,
    }


def _accept(s: dict[str, Any]) -> bool:
    return s["phone"] or s["email"] or s["name"] >= NAME_STRONG


def match(resumes: list[dict[str, Any]], rows: list[list[str]], mapping: dict[str, int | None]):
    """Greedy one-to-one assignment on the strongest evidence first."""
    pairs = []
    for ri, resume in enumerate(resumes):
        if not resume.get("data"):
            continue
        for ti, row in enumerate(rows):
            s = score_pair(resume, row, mapping)
            if _accept(s):
                pairs.append((s["score"], ri, ti, s))
    pairs.sort(key=lambda p: p[0], reverse=True)

    by_resume: dict[int, tuple[int, dict[str, Any]]] = {}
    taken_rows: set[int] = set()
    contested: dict[int, list[int]] = {}
    for _, ri, ti, s in pairs:
        if ri in by_resume:
            continue
        if ti in taken_rows:
            contested.setdefault(ri, []).append(ti)
            continue
        by_resume[ri] = (ti, s)
        taken_rows.add(ti)

    # Unreadable resumes: attach to a tracker row by file name only, so the
    # candidate shows once (as a red row with tracker data) instead of twice.
    for ri, resume in enumerate(resumes):
        if resume.get("data") or ri in by_resume:
            continue
        best, best_sim = None, 0.0
        for ti, row in enumerate(rows):
            if ti in taken_rows:
                continue
            sim = rules.name_similarity(resume.get("file_stem") or "", row_value(row, mapping, "name"))
            if sim > best_sim:
                best, best_sim = ti, sim
        if best is not None and best_sim >= NAME_STRONG:
            by_resume[ri] = (best, {"phone": False, "email": False, "name": round(best_sim), "score": best_sim})
            taken_rows.add(best)
    return by_resume, contested


# --------------------------------------------------------------------- row build


def _pick_phone(resume_data: dict[str, Any] | None, tracker_cell: str, notes: list[str]) -> str:
    resume_phones = [rules.normalize_phone(p) for p in (resume_data or {}).get("phones") or []]
    resume_valid = [p for p in resume_phones if rules.is_valid_phone(p)]
    tracker_phones = rules.phones_from_text(tracker_cell)
    tracker_valid = [p for p in tracker_phones if rules.is_valid_phone(p)]

    if resume_valid:
        chosen = resume_valid[0]
        if tracker_phones and chosen not in tracker_phones:
            notes.append(f"Contact differs: tracker has {rules.clean(tracker_cell)}, using resume number.")
        return chosen
    if tracker_valid:
        return tracker_valid[0]
    if tracker_phones or resume_phones:
        notes.append("Contact is not a valid 10-digit number - please check.")
        return (tracker_phones or resume_phones)[0]
    return ""


def _pick_email(resume_data: dict[str, Any] | None, tracker_cell: str, notes: list[str]) -> str:
    resume_emails = [rules.normalize_email(e) for e in (resume_data or {}).get("emails") or [] if "@" in e]
    tracker_email = rules.normalize_email(tracker_cell)
    if resume_emails:
        if tracker_email and tracker_email not in resume_emails:
            notes.append(f"Email differs: tracker has {tracker_email}, using resume email.")
        return resume_emails[0]
    return tracker_email


def _experience(resume_data: dict[str, Any] | None, tracker_total: str, today: date, notes: list[str]):
    """Priority: stated in resume > calculated from resume dates > tracker."""
    data = resume_data or {}
    stated = rules.parse_years_text(data.get("stated_total_experience"))
    months = rules.total_months(data.get("experience") or [], today)
    calculated = rules.months_label(months) if months else None
    tracker = rules.parse_years_text(tracker_total)

    if stated:
        label, value, source = stated[0], stated[1], "stated in resume"
    elif calculated:
        label, value, source = calculated[0], calculated[1], "calculated from resume dates"
    elif tracker:
        label, value, source = tracker[0], tracker[1], "from tracker"
    else:
        return "", 0.0, ""

    if tracker and source != "from tracker" and abs(tracker[1] - value) > 1:
        notes.append(f"Experience {label} ({source}) differs from tracker ({rules.clean(tracker_total)}).")
    return label, value, source


def _fact_check(resume: dict[str, Any], notes: list[str]) -> None:
    """For text resumes, confirm extracted values really appear in the text."""
    text = (resume.get("text") or "").lower()
    if not text:
        return
    flat = " ".join(text.split())
    data = resume.get("data") or {}
    edu = rules.highest_education(data.get("education") or [])
    if edu:
        year = rules._year_num(edu.get("year"))
        if year and str(year) not in flat:
            notes.append(f"Education year {year} not found in resume text.")
        inst = rules.clean(edu.get("institute")).lower()
        if inst and rules.fuzz.partial_ratio(inst, flat) < 80:
            notes.append("Education institute not found word-for-word in resume text.")
    for role in (data.get("experience") or [])[:6]:
        comp = rules.clean(role.get("company")).lower()
        if comp and rules.fuzz.partial_ratio(comp, flat) < 80:
            notes.append(f"Company '{role.get('company')}' not found word-for-word in resume text.")


def _empty_row() -> dict[str, str]:
    return {c: "" for c in COLUMNS}


def build_table(
    resumes: list[dict[str, Any]],
    tracker: dict[str, Any],
    mapping: dict[str, int | None],
    today: date | None = None,
) -> dict[str, Any]:
    today = today or date.today()
    rows: list[list[str]] = tracker.get("rows") or []
    by_resume, contested = match(resumes, rows, mapping)
    matched_rows = {ti for ti, _ in by_resume.values()}

    out: list[dict[str, Any]] = []

    def tracker_part(row: list[str] | None, values: dict[str, str]) -> None:
        if row is None:
            return
        values["Current CTC (Fixed) + Any variable"] = rules.format_current_ctc(
            row_value(row, mapping, "current_ctc"), row_value(row, mapping, "variable")
        )
        values["Expected CTC (Fixed)"] = rules.clean(row_value(row, mapping, "expected_ctc"))
        values["Notice Period/Offer status"] = rules.format_notice_offer(
            row_value(row, mapping, "notice"), row_value(row, mapping, "offer")
        )
        values["Recruiter_Comments"] = rules.clean(row_value(row, mapping, "comments"))

    for ri, resume in enumerate(resumes):
        data = resume.get("data")
        notes: list[str] = []
        values = _empty_row()
        row = None
        status = "matched"
        match_info: dict[str, Any] | None = None

        if not data:
            status = "failed"
            notes.append(resume.get("error") or "Could not read this resume.")
            if ri in by_resume:
                row = rows[by_resume[ri][0]]
                notes.append("Tracker details filled in; resume columns need to be added by hand.")
        elif ri in by_resume:
            ti, s = by_resume[ri]
            row = rows[ti]
            match_info = {"tracker_row": ti, **s}
            evidence = [k for k in ("phone", "email") if s[k]]
            if not evidence:
                status = "check"
                notes.append(f"Matched on name only ({s['name']}% similar) - please confirm.")
            elif s["name"] < NAME_WEAK:
                status = "check"
                notes.append(
                    f"Matched on {' & '.join(evidence)} but names differ "
                    f"(resume: {data.get('name')}, tracker: {row_value(row, mapping, 'name')})."
                )
        else:
            status = "unmatched"
            notes.append("No matching candidate found in the tracker.")
        if ri in contested and status != "failed":
            notes.append("Another resume also looked like this tracker candidate - please confirm.")
            if status == "matched":
                status = "check"

        if data:
            values["Name"] = rules.smart_title(data.get("name") or "") or (
                rules.smart_title(row_value(row, mapping, "name")) if row else resume.get("file_stem", "")
            )
            label, exp_value, exp_source = _experience(
                data, row_value(row, mapping, "total_exp") if row else "", today, notes
            )
            values["No. of Years of Experience"] = label
            values["Education (Highest)"] = rules.format_education(
                rules.highest_education(data.get("education") or [])
            )
            values["Companies (Last 3)"] = rules.format_companies(data.get("experience") or [], today)
            _fact_check(resume, notes)
        else:
            values["Name"] = rules.smart_title(row_value(row, mapping, "name") if row else resume.get("file_stem", ""))
            tracker_total = rules.parse_years_text(row_value(row, mapping, "total_exp")) if row else None
            if tracker_total:
                values["No. of Years of Experience"] = tracker_total[0]
                exp_value, exp_source = tracker_total[1], "from tracker"
            else:
                exp_value, exp_source = 0.0, ""

        values["Contact No"] = _pick_phone(data, row_value(row, mapping, "phone") if row else "", notes)
        values["Email id"] = _pick_email(data, row_value(row, mapping, "email") if row else "", notes)
        tracker_part(row, values)

        if data and not values["Education (Highest)"]:
            notes.append("No education found in resume.")
        if data and not values["Companies (Last 3)"]:
            notes.append("No work experience found in resume.")

        out.append({
            "id": resume.get("id"),
            "source": resume.get("filename"),
            "read_mode": resume.get("mode"),
            "status": status,
            "notes": notes,
            "match": match_info,
            "experience_source": exp_source,
            "sort_value": exp_value,
            "values": values,
        })

    # Tracker candidates with no resume.
    for ti, row in enumerate(rows):
        if ti in matched_rows:
            continue
        values = _empty_row()
        values["Name"] = rules.smart_title(row_value(row, mapping, "name"))
        notes: list[str] = ["No resume uploaded for this tracker candidate."]
        tracker_total = rules.parse_years_text(row_value(row, mapping, "total_exp"))
        if tracker_total:
            values["No. of Years of Experience"] = tracker_total[0]
        values["Contact No"] = _pick_phone(None, row_value(row, mapping, "phone"), notes)
        values["Email id"] = rules.normalize_email(row_value(row, mapping, "email"))
        tracker_part(row, values)
        out.append({
            "id": f"tracker-{ti}",
            "source": "Tracker only",
            "read_mode": None,
            "status": "unmatched",
            "notes": notes,
            "match": None,
            "experience_source": "from tracker" if tracker_total else "",
            "sort_value": tracker_total[1] if tracker_total else 0.0,
            "values": values,
        })

    # Most experienced first; problem rows stay in place within that order.
    out.sort(key=lambda r: r["sort_value"], reverse=True)
    return {"columns": COLUMNS, "rows": out}
