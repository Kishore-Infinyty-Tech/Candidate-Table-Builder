# Candidate Table Builder

Turns a recruiter **tracker Excel** and **2–50 resumes (PDF / DOCX)** into a
client-ready **Excel table**.

| Column | Source |
|---|---|
| Name, No. of Years of Experience, Education (Highest), Companies (Last 3) | Resume |
| Contact No, Email id | Resume first, cross-checked with tracker |
| Current CTC (Fixed) + Any variable, Expected CTC (Fixed), Notice Period/Offer status, Recruiter_Comments | Tracker |

## Run locally (Windows)

1. Get the code: on GitHub click **Code → Download ZIP** and unzip it
   (do not copy `.venv` or `node_modules` from another computer).
2. Double-click **`start.bat`**. On the first run it:
   - installs Python and Node.js if they are missing (Windows may ask for
     permission — click **Yes**),
   - installs the packages and builds the dashboard (a few minutes, needs internet),
   - asks for your Gemini API key (free at <https://aistudio.google.com/apikey>)
     and saves it in `.env`.
3. The dashboard opens at <http://localhost:8000>. Keep the black window open
   while using it; close it to stop the app.

Next time, double-clicking `start.bat` starts the app in a few seconds.
If automatic installation is not possible, install
[Python 3.11+](https://www.python.org/downloads/) (tick **Add python.exe to PATH**)
and [Node.js LTS](https://nodejs.org/), then run `start.bat` again.

### Developer mode (hot reload)

```bash
# terminal 1 – API on :8000
.venv/Scripts/python -m uvicorn api.index:app --reload --port 8000
# terminal 2 – dashboard on :5173 (proxies /api to :8000)
cd frontend && npm run dev
```

## How it works

1. **Tracker** – columns are found by header text, so column order may change.
   The dashboard shows the detected columns and lets you correct them.
2. **Resumes** – each file is read in the browser:
   - DOCX or text PDF → only the text is sent.
   - Scanned / image PDF → the PDF itself is sent so Gemini can read the pages.
3. **Extraction** – Gemini returns raw facts only (names, dates, degrees). All
   formatting and calculations are done in code (`api/_core/rules.py`).
   - Up to 10 resumes go in one batch; larger runs go 5 per minute.
   - If a model is busy or its free daily quota is used up, the next model in
     `GEMINI_FALLBACK_MODELS` is used.
4. **Matching** – every resume is scored against every tracker row on phone,
   email and name, then matched one-to-one. Name-only or conflicting matches
   are flagged **Check**; anything without a match is **Unmatched** and red.
5. **Review** – edit any cell, choose which rows are red, then download.
   The file is named with the current date and time.

## Formatting rules

- **Experience:** stated in resume (e.g. "3+ years") → else calculated from job
  dates (overlaps merged, gaps skipped) → else tracker. `4+ Years` / `4 Years`.
- **Education:** highest degree (PhD > Master's > Bachelor's),
  `Degree - Branch, Institute (Year)` using only the parts the resume states.
- **Companies:** last 3 companies, one per line,
  `1. Company – Title | Mon YYYY – Present`. With fewer than 3 companies the
  remaining lines show individual roles.
- **CTC:** `12.3 Lpa (All Fixed)` or `10 Lpa (Fixed) + 2 Lpa (Variable)`.
- **Notice / offer:** `<notice period as written> | <offer & DOJ>`; any LWD in
  the offer cell is dropped; no offer → `No Offers`.
- **Phone:** 10 digits without +91; resume number wins over tracker; mismatches
  and invalid numbers are flagged.

## Configuration (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | – | Required |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Main model |
| `GEMINI_FALLBACK_MODELS` | `gemini-3.5-flash,gemini-3.1-flash-lite,gemini-3.5-flash-lite` | Used when the main model is busy or out of daily quota |
| `EXTRACT_PARALLEL` | `5` | Resumes sent to Gemini at the same time |

> Gemini free tier allows only about 20 requests **per model per day**, so the
> fallback chain matters for larger runs.
