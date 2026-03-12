# ABC License Tracker — Design Spec

**Project:** California ABC New License Tracker for Jordon (Crest Distribution)
**URL:** roblogic.org/jordon
**Date:** 2026-03-12
**Status:** Draft

## Purpose

Jordon is a Crest beverage distribution rep covering San Diego County (primarily North County). New ABC liquor licenses = new accounts to prospect. This tool gives him a daily-updated page showing every license issued in San Diego County YTD, with a map view of his territory and a filterable table.

## Architecture Overview

```
ABC CSV (daily 7am PT)
        │
        ▼
   n8n workflow (daily 8am PT cron)
        │
        ├─ Download + decompress bulk CSV zip
        ├─ Parse + filter (SD County, current year, licensed)
        ├─ Geocode new addresses (Nominatim/OSM, structured search)
        ├─ Write jordon-abc-data.json
        ├─ Commit via GitHub API (no git CLI needed)
        │
        ▼
   Cloudflare Pages (auto-deploy on commit)
        │
        ▼
   roblogic.org/jordon (static HTML + JS)
        ├─ Map view (Leaflet + OSM tiles)
        ├─ Filterable/sortable table
        └─ Client-side stale data detection
```

## Data Source

- **URL:** `https://www.abc.ca.gov/wp-content/uploads/DailyExport-CSV.zip`
- **Format:** Zipped CSV, ~129K rows, refreshed daily at 7am PT
- **San Diego County:** ~11K total records, ~123 issued in 2026 YTD (as of March 12)
- **Row 1:** Timestamp metadata (skip). File has UTF-8 BOM (`EF BB BF`) — must strip before parsing.
- **Row 2:** Header row. Note: two headers have leading spaces (`" Prem Addr 2"`, `" Prem State"`) — trim all header names during parse.
- **Inner filename:** Always `ABC-DailyDataExport.csv`

### CSV Fields (relevant subset)

| Field | Example | Use |
|-------|---------|-----|
| License Type | 47 | Map to human label, color-code pins |
| File Number | 00513236 | Unique ID |
| Lic or App | LIC | Filter: only LIC (issued), not APP |
| Type Status | ACTIVE | Display |
| Type Orig Iss Date | 10-FEB-2026 | Filter: current year YTD; sort column |
| Expir Date | 30-SEP-2026 | Display |
| Primary Name | TIMES SQUARE 2011 INC | Fallback display name |
| Prem Addr 1 | 12215 VENTURA BLVD | Address, geocoding input |
| Prem Addr 2 | # 209-211 | Suite/unit (note: leading space in header) |
| Prem City | STUDIO CITY | Display, filter |
| Prem Zip | 91604-2533 | Display |
| DBA Name | JESSE'S BAR | Primary display name (if present; may be single space — trim before checking) |
| Prem County | SAN DIEGO | Filter: only SD County |

### License Type Labels

All 16 types present in SD County 2026 data (count as of March 12):

| Code | Count | Label | Category |
|------|-------|-------|----------|
| 41 | 31 | On-Sale Beer & Wine — Eating Place | On-premise |
| 47 | 23 | On-Sale General — Eating Place | On-premise |
| 20 | 12 | Off-Sale Beer & Wine | Off-premise |
| 02 | 8 | Winegrower | Producer |
| 23 | 7 | Small Beer Manufacturer | Producer |
| 21 | 7 | Off-Sale General | Off-premise |
| 18 | 5 | Distilled Spirits Wholesaler | Wholesale |
| 12 | 5 | Distilled Spirits Importer | Wholesale |
| 09 | 5 | Beer & Wine Importer | Wholesale |
| 86 | 4 | Instructional Tasting License | Other |
| 77 | 4 | Event Permit | Other |
| 58 | 4 | Caterer's Permit | On-premise |
| 17 | 4 | Beer & Wine Wholesaler | Wholesale |
| 48 | 2 | On-Sale General — Public Premises | On-premise |
| 70 | 1 | On-Sale General — Restrictive Service | On-premise |
| 68 | 1 | Portable Bar | On-premise |

Full type list maintained in code for label lookups. Types not in the map display as "Type {code}".

### Pin Color Categories
- **Blue:** On-premise (restaurants, bars, caterers — types 40, 41, 42, 47, 48, 58, 61, 68, 70, 75, 76)
- **Green:** Off-premise (retail — types 20, 21)
- **Purple:** Producer/Wholesale (types 02, 09, 12, 17, 18, 23)
- **Orange:** Other (types 77, 86, and any unmapped type)

## n8n Workflow

### Trigger
- **Schedule Trigger:** Daily at 8:00 AM PT (1 hour after ABC refresh)

### Nodes

1. **HTTP Request** — GET the zip file, binary response
2. **Compression node** — Decompress zip (n8n built-in). The Code node cannot `require('zlib')` with current allowed builtins.
3. **Code (Parse + Filter)** — Parse CSV text, strip BOM, trim headers, filter:
   - `Prem County` = "SAN DIEGO" (case-insensitive)
   - `Lic or App` = "LIC"
   - `Type Orig Iss Date` year = current year (derived at runtime, not hardcoded — handles Jan rollover)
   - Trim DBA Name before checking presence (can be single space `" "`)
   - Output: array of clean JSON objects
4. **Code (Diff for geocoding)** — Read previous JSON from disk (`NODE_FUNCTION_ALLOW_BUILTIN` includes `fs`). Identify records needing geocoding: either new file numbers not in previous data, OR existing records with `lat: null` (retry failed geocodes).
5. **HTTP Request (loop)** — For each new address, hit Nominatim structured search:
   - `https://nominatim.openstreetmap.org/search?street={addr1}&city={city}&state=California&postalcode={zip}&format=json&limit=1`
   - Structured search yields better results than free-form `q=` for US addresses
   - Omit address2 (suite/unit) from geocoding query — it confuses Nominatim
   - Rate limit: 1 request/sec (n8n's SplitInBatches + Wait node)
   - User-Agent header required by Nominatim TOS: `"ABCLicenseTracker/1.0 (roblogic.org)"`
6. **Code (Merge + Output)** — Merge geocode results into data, write final JSON to n8n data volume
7. **GitHub node** — Commit `jordon/jordon-abc-data.json` to the `roblogic` repo via GitHub API. No git CLI needed, no repo mount needed. Requires GitHub personal access token credential in n8n.
8. **Error branch** — On any node failure:
   - POST to ntfy.sh topic for push notification
   - Note: index.html is never overwritten (see Error Handling section)

### GitHub API Commit (node 7 detail)
Uses n8n's GitHub node or HTTP Request to the GitHub Contents API:
```
PUT /repos/TheRobLogic/roblogic/contents/jordon/jordon-abc-data.json
```
Body includes base64-encoded JSON content and the SHA of the existing file (for updates; omit SHA on initial creation). This triggers Cloudflare Pages auto-deploy without needing git installed in the container.

### Data Output Schema (jordon-abc-data.json)

```json
{
  "updated": "2026-03-12T08:02:15-07:00",
  "count": 123,
  "licenses": [
    {
      "fileNumber": "00600123",
      "licenseType": 47,
      "typeLabel": "On-Sale General — Eating Place",
      "category": "on-premise",
      "status": "ACTIVE",
      "issueDate": "2026-02-10",
      "expirationDate": "2027-02-28",
      "businessName": "THE BEST TACOS LLC",
      "dbaName": "TACO ROYALE",
      "displayName": "TACO ROYALE",
      "address": "1234 MAIN ST",
      "address2": "STE 100",
      "city": "ENCINITAS",
      "zip": "92024",
      "lat": 33.0369,
      "lng": -117.2919
    }
  ]
}
```

- `displayName`: DBA if present, else Primary Name
- `lat`/`lng`: null if geocoding failed (pin omitted from map, row still in table)
- `category`: "on-premise", "off-premise", "wholesale", or "other" (derived from license type code — four values to match four pin colors)

## Frontend (jordon/index.html)

### Layout

```
┌─────────────────────────────────────┐
│  Header: "SD County New Licenses"   │
│  Subtitle: "YTD 2026 · Updated {d}" │
│  [Search box]  [Type filter ▼]      │
├─────────────────────────────────────┤
│                                     │
│         Leaflet Map                 │
│    (SD County, zoom ~10)            │
│    Color-coded pins                 │
│    Click → popup with details       │
│                                     │
├─────────────────────────────────────┤
│  "Showing 43 of 123 licenses"       │
├─────────────────────────────────────┤
│  Sortable Table                     │
│  Date | Name | Type | Address | ... │
│  (newest first by default)          │
│                                     │
└─────────────────────────────────────┘
```

### Map Details
- **Library:** Leaflet.js (CDN, no build step)
- **Tiles:** OpenStreetMap (free, no API key)
- **Center:** San Diego County (~32.85, -117.05), zoom level ~10
- **Pin colors:** Per category defined in License Type Labels section (blue/green/purple/orange)
- **Pin popup:** Business name, license type, address, issue date
- **Filter sync:** Text search and type dropdown filter both the table AND the map pins
- **No-coords handling:** Records with `lat: null` are omitted from map, still appear in table

### Table Details
- **Columns:** Issue Date, Business Name, License Type, Address, City, Status
- **Sort:** Click column headers to sort. Default: newest first.
- **Search:** Real-time text filter across all visible columns
- **Type filter:** Dropdown with all license types present in data
- **Row count:** "Showing X of Y licenses" updates live with filters
- **Mobile:** Responsive — map stacks above table, table scrolls horizontally if needed

### Style Direction
- Clean, professional, but not boring
- Dark header/map area, light table for readability
- Crest brand colors if appropriate (or just a sharp blue/white palette)
- Should feel like a tool built for him, not a generic dashboard

### Dependencies (all CDN, no build)
- Leaflet.js + Leaflet CSS
- No framework — vanilla JS
- Data loaded via fetch('jordon-abc-data.json')

## Error Handling

### Stale Data Detection (index.html handles it client-side)
- `index.html` is a static file that is **never overwritten** by the pipeline
- On load, it reads `jordon-abc-data.json` and checks the `updated` timestamp
- If data is >36 hours old, shows a warning banner: "Data may be outdated — last updated {date}. Pipeline issue detected, check back tomorrow."
- If fetch fails entirely (JSON missing/corrupted), shows the full error state:
  - Uses `technical-difficulties.png` (same as bookersummary)
  - "License Tracker Pipeline Down" heading
  - "Check back tomorrow — data refreshes daily."
- This approach means a successful run always auto-recovers — no need to overwrite index.html

### n8n Failure Notification
- POST to ntfy.sh topic on workflow error
- Message: "ABC License Tracker failed: {error summary}"

### Geocoding Failures
- Non-fatal — record gets `lat: null, lng: null`
- Pin omitted from map, row still appears in table
- Retry on next run (diff logic sees missing coords)

## File Structure

```
~/github/roblogic/jordon/
├── index.html              # Main page (map + table + error states, never overwritten by pipeline)
├── jordon-abc-data.json    # Data file (generated by n8n, committed via GitHub API)
└── technical-difficulties.png  # Error image (copy from bookersummary)
```

n8n workflow exported to: `~/docker/n8n/workflows/abc-license-tracker.json` (backup)

### n8n Requirements
- GitHub personal access token credential (repo scope) configured in n8n
- `NODE_FUNCTION_ALLOW_BUILTIN` already includes `fs,path,https` (confirmed in docker-compose)

## Future Enhancements (not in v1)

- Email/SMS notifications when new licenses appear in North County specifically
- Multi-county support (toggle other SoCal counties)
- License type breakdown charts
- "Days since issued" aging indicator
- Direct link to ABC license detail page per record
- Handoff: export n8n workflow for Jordon to run independently

## Out of Scope

- Authentication (public page, no sensitive data — ABC data is public record)
- Historical tracking beyond YTD (can extend later)
- Integration with Crest's internal systems
