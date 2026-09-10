# AyurCentral HRMS — Google Sheets data-access performance audit

**Date:** 11 September 2026  
**Scope:** Audit and optimization plan only. No application code was changed. No schema change. No spreadsheet split.  
**Code inspected:** `apps-script/src` on branch `cursor/experiment-500f`.  
**Scale assumed:** ~200 employees across SAPL / AOPL / AOMS, stored in **one** Google Spreadsheet. Row counts below are estimates from schema and access patterns, not a live sheet dump.  
**Timings:** Not measured in this pass. Rankings are from access patterns. `HrmsPerf` already exists and is off unless `HRMS_PERF_TIMING=1`.

**Interactive view:** Cursor canvas `hrms-sheets-perf-audit.canvas.tsx` (open beside chat).

Full-sheet read classes used below:

| Class | Meaning |
| --- | --- |
| **A** | Appropriate full read |
| **B** | Could use a smaller range |
| **C** | Should use cached data across RPCs |
| **D** | Should use an in-memory index after one read |
| **E** | Should be redesigned to batch data access |

---

## Verdict

**Scanning ~200 employees in JavaScript is not why this HRMS feels slow.**

Each `google.script.run` is a **new** Apps Script execution that re-opens the spreadsheet. Request-scoped caches in `DbService` and `ConfigService` are cleared at `hrmsRun_` entry, so they do not survive across UI calls. The expensive work is:

1. Round trips (UI → Apps Script → Sheets)
2. `SpreadsheetApp.openById`
3. Per-row Sheet writes (`updateRecord` in a loop; `sheet.deleteRow` in a loop)

**Recommendation: KEEP ONE DATABASE.** Do not split by vertical at this scale.

Relative concern (code inspection only, 1–10, **not** measured milliseconds):

| Concern | Score |
| --- | ---: |
| Per-row payroll writes (`saveInputs` / LOP refresh) | 10 |
| `deleteRow` loops on payroll recalculate | 9 |
| Frontend RPC amplification | 8 |
| Payroll run payload (`getRunDetail`) | 7 |
| Growing history sheets (leave / payroll / inbox / audit) | 6 |
| 200-employee JavaScript scan | 2 |

---

## A. Current data-access architecture

```
HRMS UI (google.script.run)
  → hrmsRun_          clears DbService + spreadsheet + session caches
  → AuthService       Users/Employees findOne, or 15s identity CacheService hit
  → PermissionService in-memory RBAC (no extra sheet read)
  → module Service    Employee / Leave / Payroll / PMS / ATS / Notifications
  → DbService         request-scoped sheet / values / column cache
  → ConfigService.openSpreadsheet()   one openById per execution
  → one Google Spreadsheet
```

### What already exists (do not rebuild)

| Mechanism | Where | Lifetime |
| --- | --- | --- |
| Spreadsheet handle cache | `ConfigService.openSpreadsheet` | One Apps Script execution |
| Sheet object cache | `DbService.getSheet_` | One execution |
| Full values cache | `DbService.getSheetValues_` | One execution; invalidated on write |
| Column cache | `DbService.getColumnValues_` | One execution; invalidated on write |
| Single-key lookup | `DbService.findOne` → column + one row | Used when the full sheet is not already cached |
| Batch insert | `DbService.insertRecords` | Used by payroll seed / calculate insert |
| Batch update | `DbService.updateRecords` | Used by notification mark-all; **not** by payroll saveInputs |
| Settings CacheService | `ConfigService.loadSettingsMap_` | 120s TTL; bypasses DbService |
| Identity CacheService | `AuthService` | 15s TTL; generation bump on Users/Employees writes |
| Request session cache | `AuthService.resolveSession` | One execution |
| Lazy module HTML | `apiGetModuleUi` | Shell does not inline module clients |
| Split dashboard | `apiGetHomeDashboard` then `apiGetHomeDashboardMore` | Avoids blocking first paint |
| Idle module preload | `Scripts.html` one-at-a-time | Pauses when the user navigates |

### How reads actually work

- `getAllRecords(sheet)` and `findRecords(sheet, filter)` always load the sheet’s used range via `getDataRange().getValues()`, then filter in JavaScript.
- A **second** read of the same sheet in the **same** execution is free (values cache).
- `findOne(sheet, { oneKey: value })` uses a column scan + one row **unless** the full sheet is already cached.
- `findOne` with **two or more** keys falls through to `findRecords` (full sheet).
- `updateRecord` / `insertRecord` / `deleteRecords` **invalidate** that sheet’s cache immediately. A loop of writes therefore re-reads after every row.
- Vertical is encoded in `employee_id` (`SAPL-0001`, `AOPL-0001`, `AOMS-0001`). There is **no** `vertical` column and no per-vertical spreadsheet.

### Core sheets (SchemaService)

Employees, Users, LeaveTypes, LeaveBalances, LeaveRequests, SalaryStructures, SalaryComponents, PayrollRuns, PayrollInputs, PayrollRecords, Notifications (email log), AuditLog, Settings, Documents.

### Module sheets (same spreadsheet)

- PMS: PerformanceCycles, PerformanceGoals, PerformanceReviews, PerformanceRatings
- ATS: JobRequisitions, Candidates, Applications, Interviews, CandidateActivity
- Notifications: NotificationInbox, NotificationPreferences (email log reuses `Notifications`)

---

## B. Full-sheet read inventory

Approximate rows assume ~200 employees and a few leave types — **not** a live sheet count.

| Sheet | Typical callers | Operation | Entire sheet? | Columns | Approx rows | How often | Class | Concern |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Employees | Directory, leave maps, payroll `indexEmployees_`, PMS dashboard, Ask HR, compensation picker | `getAllRecords` | Yes | ~26 | ~200 | Every directory / payroll open / dashboard-more / leave HR | **A** | Cheap. Do not partition for this. |
| Users | Auth `findOne` by email; first-admin bootstrap `getAll` | column + row / rare full | No on hot path | ~9 | ~200 | Every RPC on identity-cache miss | **A / D** | Already indexed + 15s cache. |
| LeaveTypes | LeaveService, LeaveLopService, payroll seed | `getAllRecords` | Yes | ~13 | ~5–10 | Many leave/payroll APIs | **A / C** | Tiny. CacheService would save RPCs, not scan time. |
| LeaveBalances | `findBalance_` always `getAll` then scan | `getAllRecords` | Yes | ~10 | ~1–2k | Leave my-leave, grant, start year | **D** | Index by employee+type+year after one read. |
| LeaveRequests | Approvals, admin list, calendar, LOP, getMyLeave | `getAllRecords` / `findRecords` | Yes, then filter | ~16 | grows with years | Dashboard, leave pages, payroll seed | **A now / E later** | Fine today. Archive old years before any DB split. |
| SalaryStructures | Compensation, `getStructureInForce`, payroll calculate | `findRecords` → full sheet | Yes | ~11 | ~200–400 | Calculate (once then cached), editor | **A / D** | First read in calculate is fine. |
| SalaryComponents | Same | `findRecords` → full sheet | Yes | ~9 | ~1.5–3k | Calculate | **A / D** | Map by `salary_structure_id` once. |
| PayrollRuns | `listRuns`, `findOpenRun_`, dashboard-more | `getAllRecords` | Yes | ~14 | tens | Payroll home, dashboard-more | **A** | Small. |
| PayrollInputs | `getRunDetail`, calculate, saveInputs | full sheet then filter by run | Yes | ~13 | ~200 × N runs | Every payroll open / save / calculate | **B / E** | JS filter is fine. Writes and payload size are not. |
| PayrollRecords | calculate, getRunDetail, lock checks | full sheet then filter | Yes | ~20 | ~200 × N runs | Calculate, open run | **B / E** | `deleteRow` loop on recalculate is the cliff. |
| NotificationInbox | Bell, unread, mark-all | projected 5 cols / `getAll` | Unread: 5 cols; list: full | 18 | grows | Dashboard primary, bell open | **B / C** | Unread already projected. Bell lists then slices. |
| NotificationPreferences | prefs APIs | `findRecords` / `getAll` | Yes if no employee filter | ~6 | ~200 × types | Prefs page | **A** | Small. |
| Notifications (email log) | admin log / retry | `getAllRecords` | Yes | ~10 | grows | Admin only | **B** | Not on login. |
| Documents | profile docs + payslips | `findRecords` | Yes then filter | ~8 | grows | Profile extras | **B** | Two RPCs can read the same sheet twice. |
| AuditLog | `AuditService.getRecent` | `getAll` then sort/slice | Yes | ~9 | unbounded | Admin audit API | **B** | Not on login. Will hurt if a viewer is added. |
| Settings | `ConfigService.loadSettingsMap_` | `getDataRange` bypassing DbService | Yes on cache miss | ~7 | ~20 | Cache miss / sequence writes | **C** | Already CacheService. |
| PerformanceCycles/Goals/Reviews/Ratings | `PmsService.getDashboard` | `getAllRecords` × 4 | Yes | varies | small now | Dashboard-more, PMS home | **A** | Fine at current cycle volume. |
| JobRequisitions / Applications / Interviews | ATS dashboard, listJobs, bootstrap | `getAllRecords` | Yes | varies | small now | Dashboard-more, ATS home | **A** | `getJob` still N `findCandidate` row reads. |

### Direct `getDataRange()` outside DbService

| File | Function / context | When | Class |
| --- | --- | --- | --- |
| `foundation/ConfigService.gs` | `loadSettingsMap_` | Settings CacheService miss | **C** — keep CacheService |
| `foundation/SchemaService.gs` | `seedDefaultSettings_` | Database setup | **A** |
| `ats/AtsSchemaService.gs` | settings seed | ATS setup | **A** |
| `employee/EmployeeBulkService.gs` | parse uploaded workbook | Bulk import | **A** |
| `payroll/PayrollBulkService.gs` | parse uploaded workbook | Bulk import | **A** |
| `payroll/CompensationBulkService.gs` | parse uploaded workbook | Bulk import | **A** |
| `ats/AtsBulkService.gs` | parse uploaded workbook | Bulk import | **A** |

Hot-path operational reads go through `DbService`. Cell-by-cell `getValue` / `setValue` is **not** the list/directory pattern anymore.

### `findOne` vs `findRecords` trap

- One key → column index + one row (good).
- Two keys (example: CURRENT salary structure by `employee_id` + `status`) → full-sheet `findRecords`.
- That is acceptable once the sheet is already cached in the same request; wasteful as the first call of a tiny lookup.

---

## C. Repeated read inventory

Inside **one** Apps Script execution, repeating `getAllRecords("Employees")` is already free after the first hit. Costly repeats are **across RPCs** and **after writes that invalidate the cache**.

| Operation | Repeat pattern | Same-request cache? | Fix |
| --- | --- | --- | --- |
| Payroll `saveInputs` | `findOne` + `updateRecord` per employee (~200) | No — each write invalidates | One `updateRecords` batch |
| Payroll `refreshLop` / `applyLeaveLopToDays` | ~200 × `updateRecord`; ~200 × `computeLopFromLeave` | Leave sheets yes; inputs no after first write | Compute all LOP in memory, one batch write |
| Payroll `calculate` | `getStructureInForce` per employee, then `deleteRow` loop, then `getRunDetail` | Structures/components yes | Keep in-memory loop; replace `deleteRow`; do not rebuild full detail twice |
| Leave `startLeaveYear` | `grantBalancesForEmployee` per person; **each takes its own script lock** | Balances wiped on every insert | One lock, one balances read, `insertRecords` |
| ATS `getJob` | `findCandidate` per application | Column cache yes; still N row reads | `listCandidates` once, index by id |
| Employee directory | `listAll` then `listAll` again for manager names | Yes — second is a cache hit | None needed |
| Leave apply (3 RPCs) | LeaveTypes + Employees loaded in types/list APIs **and** again inside `getMyLeave` | No — three executions | One apply-bundle API |
| Profile extras | Documents sheet via docs RPC and again via payslips RPC | No — two executions | Lazy tabs or one documents read |
| `getRunDetail` | Always `syncEligibleEmployees` (script lock) even when opening an existing run | Partial | Skip sync when not DRAFT/CALCULATED; avoid lock on pure reads |

### Auth on every RPC

Every API goes through `hrmsRun_` → `resolveSession`. On identity-cache miss this is `findOne(Users)` + `findOne(Employees)` (column + row), plus Settings CacheService. That is **not** a 200-row employee scan. It still costs `openById` if anything else in the request touches Sheets.

---

## D. Frontend API amplification

`google.script.run` does **not** share `DbService` memory. `Promise.all` still opens the spreadsheet N times. Concurrent RPCs contend on `LockService` when any of them writes.

| Page | Initial backend calls | What each reads | Combine? | Duplicate data? |
| --- | --- | --- | --- | --- |
| Post-login shell | 1 `apiGetAppBootstrap` + 1 `apiGetHomeDashboard`, then `apiGetHomeDashboardMore`, then idle `apiGetModuleUi` one-at-a-time | Users/Employees (or identity cache), Settings; inbox cols + leave approvals; then payroll/PMS/ATS; then HTML partials | Keep the split for first paint. Do not merge more into bootstrap. | Unread count reused from dashboard into the bell (`skipInitialFetch`). |
| Dashboard (HR) | 2 sequential | Primary: NotificationInbox + LeaveRequests + Employees + LeaveTypes. More: PayrollRuns + 4 PMS sheets + 3 ATS sheets | Already split. **More** is the heavy call. | PMS/ATS fetched again when those modules open. |
| Leave apply | **3 parallel:** `apiLeaveGetTypes`, `apiLeaveListEmployees`, `apiLeaveGetMyLeave` | LeaveTypes; Employees; then my-leave reads types + balances + requests + employees **again** | **Yes** — one apply bundle. `getMyLeave` already returns types. | Types twice. Employees twice for HR. |
| Leave approvals | 1 `apiLeaveGetApprovals` | LeaveRequests + types + employees | No | — |
| Leave admin | 2 parallel: admin list + employees | All LeaveRequests + types + employees; then employees again | **Yes** — include picker in admin list | Employees twice |
| Employee directory | 1 `apiGetEmployeeDirectory` | Full Employees (response paginated to 25) | No | No |
| Employee / my profile | 1 profile + **up to 4 extras immediately** (leave, docs, payslips, app access) | Employees + SalaryStructures; LeaveBalances + types; Documents twice; Users | Lazy-load tabs. Extras fire even if the user stays on Personal. | Documents twice if both docs and payslips tabs exist. |
| Payroll home | 2 sequential: `apiListPayrollRuns` → `apiGetPayrollRun` | PayrollRuns; then **script lock** + inputs + records + employees + possible LOP seed | Optional: return latest run with the list for the selected month | Runs listed then the same run loaded in full |
| Compensation editor | 1 `apiGetCompensationEditorBundle` (fallback `apiGetCurrentSalaryStructure` on error only) | Employee + structures + components | Happy path is already one call | — |
| PMS home | 1 `apiPmsGetDashboard` | Cycles, goals, reviews, employees | No | Cycle detail later re-reads overlapping sheets |
| PMS cycle | 3 parallel: getCycle, assignable employees, rating scale | `ensure_()` schema on getCycle; employees; ratings | Bundle getCycle | `ensure_()` on a **read** path is extra sheet metadata |
| ATS home | 1 `apiAtsGetBootstrap` (includes dashboard) | Jobs + applications + interviews + settings | Already combined. Client reuses `boot.dashboard`. | Opening jobs list re-reads the same sheets |
| Notifications page | 1 `apiGetNotifications` | Full inbox | No for first paint | Bell open is a separate list (limit 8) |

**Profile extras are a real amplifier:** leave, documents, payslips, and app-access all start as soon as the profile HTML is painted.

---

## E. Biggest performance bottlenecks

1. **Payroll `saveInputs` / LOP refresh** — per-row `updateRecord`. Each write invalidates the sheet cache, then the next row re-reads. ~200 employees → ~200 Sheet writes under one script lock.
2. **`DbService.deleteRecords` uses `sheet.deleteRow` in a loop** — payroll `calculate` deletes prior CALCULATED rows one by one. Row-shift is one of the slowest Sheets operations.
3. **Each `google.script.run` is a new execution** — three UI calls = three `openById` + three auth lookups, even when the data was read 200ms earlier in another call.
4. **`getRunDetail` always syncs eligible employees then returns the full run** — opening payroll takes a script lock, may seed LOP per new hire, and serializes ~200 input+record rows (including component breakdown JSON).
5. **History sheets grow without bound** — LeaveRequests, PayrollRecords, NotificationInbox, AuditLog. Full-sheet reads get slower with **years**, not with 200 people.

What is **not** a meaningful bottleneck at this scale:

- Filtering 200 employee objects in JavaScript
- Reading the Employees tab for directory / payroll index / leave name maps
- `findOne` login lookup of one user + one employee

---

## F. Quick wins

- Lazy-load profile tabs (leave / documents / payslips / app access only when opened).
- One leave-apply bundle API; stop parallel types + employees + my-leave.
- Include employee picker in leave admin list (drop the second Employees RPC).
- ATS `getJob`: `listCandidates` once, index by id.
- PMS: skip schema `ensure_()` on read paths (`getDashboard` already skips it; `getCycle` does not).
- Do not merge dashboard-more back into bootstrap.
- Mark-read already returns `unread_count` so the bell does not refresh — keep that.

---

## G. Medium-term improvements

- Use existing `DbService.updateRecords` for payroll inputs and LOP refresh.
- Replace `deleteRow` loops when recalculating payroll (clear a block, or rewrite without per-row delete).
- In-memory maps for leave balances and salary components inside fat operations (`calculate`, `startLeaveYear`).
- Payroll home: listRuns + latest detail in one RPC for the selected month; do not call `getRunDetail` again at the end of calculate if the in-memory result is enough.
- `startLeaveYear`: one script lock, batch `insertRecords`.
- Optional later: archive **old years** of PayrollRecords / LeaveRequests / AuditLog (hybrid by **time**, not by vertical).
- `AuditService.getRecent`: read a `getLastRow` window instead of the whole log, if an audit viewer is added.

---

## H. Indexing opportunities

Do **not** build an indexing framework. After one full read in a request, build a plain object map. At ~200 employees that is enough.

| Key | Where it would help | Simplest form |
| --- | --- | --- |
| `employee_id` → employee | Already ad hoc (`empMap_`, `indexEmployees_`). Missing in some ATS/PMS loops. | Map from `getAllRecords` once per request |
| `employee_id` → sheet row | Rarely needed; `findRowNumber` already scans one column. | Keep column cache |
| `(employee_id, leave_type_id, leave_year)` → balance | `findBalance_` scans all balances until cache is warm; writes break it | Map after one `getAllRecords` inside grant / start-year |
| `payroll_input_id` / `payroll_run_id` | `saveInputs`, calculate | Group in memory; batch write by pk |
| `salary_structure_id` → components | calculate calls `getStructureInForce` ~200 times (cache-friendly after first full read) | Map components once |
| `notification_id` | mark-read already uses `findOne` | No change |
| `google_email` → user | Auth already `findOne` + 15s snapshot | No change |
| `candidate_id` → candidate | ATS `getJob` | Map from `listCandidates` |

---

## I. Caching opportunities

| Layer | Use | Do not cache |
| --- | --- | --- |
| **Request-scoped** (already in DbService) | Spreadsheet handle, sheets, full values, columns, Auth session. Keep. Extend with in-memory maps from cached values. | — |
| **CacheService** | Settings (done), identity 15s (done), LeaveTypes, org picklists (dept/location), ATS pipeline setting | Payroll inputs/records, leave balances/requests, inbox, salary components during calculate, anything an approver might change on the next click |

Invalidation already exists:

- Identity: generation key bumped on Users/Employees writes (`DbService.invalidateSheetData`).
- Settings: `ConfigService.clearSettingsCache` on write / sequence increment.

If LeaveTypes are put in CacheService, invalidate only on `apiLeaveSaveType`.

---

## J. Batch read / write opportunities

| Opportunity | Today | Target |
| --- | --- | --- |
| Payroll `saveInputs` | N × `updateRecord` (each `setValues` + invalidate) | Validate in memory; `DbService.updateRecords` once |
| Payroll calculate replace records | N × `deleteRow` then `insertRecords` | Clear the run’s block in one range, or rewrite without per-row delete |
| LOP refresh | N × `updateRecord` | `updateRecords` |
| Leave year grant | N × `insertRecord` + nested locks | `insertRecords` under one lock |
| Employee bulk Lists sheet (template) | Cell-by-cell `setValue` | One `setValues` (template only, not hot path) |
| Audit `getRecent` | Full sheet | Last N rows via `getLastRow` window |
| ATS `getJob` candidates | N × `findOne` | One `listCandidates` |
| Schema setup default settings | `appendRow` per missing key | One `setValues` (setup only) |

`insertRecords` and `updateRecords` already exist. `deleteRecords` does **not** batch.

---

## Performance measurement (existing)

`HrmsPerf` (`foundation/PerfUtil.gs`) already records:

- API total time
- `openById`
- sheet lookup
- `getDataRange` / column / row
- write
- session
- serialize
- per-sheet read/write counts
- cache hits (`settingsCacheHit`, `sheetCacheHit`, `valuesCacheHit`, identity)

Enable:

- Script property `HRMS_PERF_TIMING=1`
- Browser `localStorage.HRMS_PERF_TIMING=1` then `HrmsApp.getPerfLog()` / console `HRMS_PERF`

Do **not** add more production logging. On a spreadsheet **copy**, capture:

- `apiGetHomeDashboard`
- `apiGetHomeDashboardMore`
- `apiGetPayrollRun`
- `apiSavePayrollInputs`
- `apiCalculatePayroll`
- `apiLeaveGetMyLeave`
- `apiGetEmployee`

That replaces inspection ranks with real milliseconds.

---

## K. Vertical database analysis

**Proposed idea:** Apps Script connected to Vertical A/B/C/D spreadsheets so HR does not “read unrelated employees.”

**This does not match how the app actually reads data.**

- Directory, payroll runs, leave approvals, notifications, PMS, and ATS dashboards are **organization-wide**.
- A single employee profile already uses `findOne` (column + row), not a 200-row scan of other verticals.
- Splitting would **not** make profile faster.
- Vertical is an id prefix, not a sheet column and not a security boundary.

| Question | Finding |
| --- | --- |
| Benefit at ~200 employees | Negligible. 200 × 26 cells is a small `getValues`. Extra `openById` calls are typically more expensive than scanning the other verticals’ rows. |
| Spreadsheet-opening overhead | `ConfigService` caches **one** handle per execution. Four files → up to four `openById` per RPC, plus routing. |
| Routing complexity | Every service would need a router (including notifications and Ask HR). |
| Org dashboards / HR search | Fan-out to every spreadsheet or a fifth rollup sheet. Today one read already has everyone. |
| Payroll | One monthly run for eligible ACTIVE employees. Split DBs force four payrolls or a cross-file gather. Both are worse operationally. |
| Leave / notifications | Approvals and inbox are per user, but HR admin lists are company-wide. Cross-file unread counts become extra RPCs. |
| Reporting | Headcount, department totals, lock exceptions join Employees to payroll/leave. Cross-spreadsheet joins are sequential `openById`. |
| Concurrency | `LockService` is **script-wide**, not spreadsheet-wide. Splitting files does not give four independent writers for payroll calculate. |
| Maintenance / backup | Four schema bootstraps, four Drive permissions, four backup jobs, four places for a missing column. |
| Security | The web app executes as the script owner (`USER_DEPLOYING`). Splitting files is **not** a row-level security boundary unless execute-as and sharing also change. Isolation would still be enforced in Apps Script, as it is today. |

### Scale: when partitioning would matter

Conceptual growth. **No invented millisecond figures.**

| Headcount | Employees sheet | What actually hurts |
| --- | --- | --- |
| **200** | Fine | RPC count, `openById`, per-row writes, script lock during payroll |
| **500** | Still fine | Same, plus payroll calculate/save duration and `getRunDetail` payload |
| **1,000** | Usually fine | LeaveRequests, PayrollRecords, inbox, audit — **history**, not the employee master. Apps Script 6-minute cap on calculate + payslips |
| **5,000** | Uncomfortable | Full-sheet reads of wide history tabs, LockService queueing, `google.script.run` payload limits, concurrent HR users |
| **10,000** | Wrong tool for transactional payroll | **Not solved by four vertical Sheets.** That is still Sheets. |

If history tabs become huge, the hybrid that can make sense is **live year vs archive spreadsheet** (split by **time**), not by vertical.

---

## L. Recommended architecture

Keep:

```
HRMS UI
  → fewer Apps Script APIs
  → service layer (unchanged modules)
  → optimized DbService
       ├── request-scoped cache          (exists)
       ├── in-memory maps after first read
       ├── selective CacheService        (Settings, identity, LeaveTypes)
       ├── indexes where useful          (plain objects, not a framework)
       ├── batch reads
       ├── batch writes                  (insertRecords / updateRecords exist)
       └── targeted ranges               (findOne column+row exists)
  → one Google Spreadsheet
```

Do **not** add Cloud SQL, Firebase, Supabase, Cloud Run, or paid infrastructure at this scale. The current architecture can stay simple.

**KEEP ONE DATABASE.** Optional later: archive old payroll/leave/audit by year.

---

## M. Recommended implementation order

Do not implement until this audit is reviewed.

| # | Change | Why first |
| ---: | --- | --- |
| 1 | Enable `HrmsPerf` on a **copy** and capture the seven APIs above | Replace inspection ranks with evidence |
| 2 | Payroll `saveInputs` + LOP refresh via `updateRecords` | Highest write amplification; API already exists |
| 3 | Replace `deleteRecords` row-loop for payroll recalculate | `deleteRow` is the likely calculate cliff |
| 4 | Combine leave-apply RPCs; lazy-load profile tabs | Cuts 2–4 spreadsheet opens on common pages; no schema change |
| 5 | Payroll listRuns + latest detail bundle; skip double `getRunDetail` after calculate | HR monthly workflow |
| 6 | In-memory maps for leave balances and salary components inside fat operations | Simplifies `startLeaveYear` and calculate without CacheService risk |
| 7 | ATS `getJob` index candidates; PMS `getCycle` skip `ensure_()` on reads | Local module cleanups |
| 8 | Only if history sheets get large: year tabs or an archive spreadsheet for old payroll/leave/audit | Hybrid by **time**, not by vertical |

---

## N. Estimated risk of each change

| Change | Risk | Notes |
| --- | --- | --- |
| Measure with existing `HrmsPerf` | **Low** | Opt-in property; no behavior change |
| Batch payroll input updates | **Medium** | Must preserve validation and lock; payroll tests exist |
| Stop `deleteRow` loops | **Medium–high** | Easy to orphan rows or shift the wrong block; needs `TestPayroll` |
| Combine leave/profile APIs | **Low–medium** | AuthZ must stay server-side per field |
| CacheService for LeaveTypes | **Low** | Invalidate on `saveType` |
| CacheService for balances / payroll | **High** | Stale pay/leave — do not |
| Split spreadsheets by vertical | **High** | No performance win at this scale; large product and ops risk |

---

## O. Files that would need modification later

**Not modifying now.** When an implementation slice is approved:

| Slice | Files |
| --- | --- |
| Payroll batch writes | `apps-script/src/payroll/PayrollService.gs`, `PayrollLeaveBridge.gs`, `leave/LeaveLopService.gs`, `tests/payroll-engine.test.js`, `apps-script/src/tests/TestPayroll.gs` |
| `deleteRecords` strategy | `apps-script/src/foundation/DbService.gs`, `PayrollService.calculate`, `pms/PmsService.gs` (rating rewrite also uses `deleteRecords`) |
| Leave apply bundle | `leave/ApiLeave.gs`, `leave/LeaveService.gs`, `leave/LeaveUi.html`, `tests/leave-engine.test.js` |
| Profile lazy tabs | `employee/EmployeeClient.html` (behavior only); optional later `employee/ApiEmployee.gs` bundle |
| Payroll home bundle | `payroll/ApiPayroll.gs`, `PayrollService.gs`, `payroll/PayrollClient.html` |
| ATS candidate index | `ats/AtsService.gs` (`getJob`) |
| PMS read path | `pms/PmsService.gs` (`getCycle` / team lists — stop `ensure_()` on reads) |

---

## Key code references

| Concern | Location |
| --- | --- |
| Request cache + full-sheet read | `apps-script/src/foundation/DbService.gs` (`getSheetValues_`, `findRecords`, `updateRecord`, `deleteRecords`) |
| Cache cleared every RPC | `apps-script/src/foundation/Errors.gs` (`hrmsRun_`) |
| `openById` once per execution | `apps-script/src/foundation/ConfigService.gs` |
| Identity 15s cache | `apps-script/src/foundation/AuthService.gs`, `Constants.gs` `HRMS.CACHE.IDENTITY_*` |
| Timing (opt-in) | `apps-script/src/foundation/PerfUtil.gs` |
| Per-row payroll save | `apps-script/src/payroll/PayrollService.gs` `saveInputs` |
| `deleteRow` loop | `DbService.deleteRecords`; called from `PayrollService.calculate` |
| `getRunDetail` + lock | `PayrollService.getRunDetail` → `syncEligibleEmployees` |
| Leave apply 3 RPCs | `apps-script/src/leave/LeaveUi.html` `renderApply` |
| Profile extras | `apps-script/src/employee/EmployeeClient.html` `drawProfile` |
| Dashboard split | `foundation/HomeDashboardService.gs`, `ui/Scripts.html` |
| Perf contracts (tests) | `tests/perf-optimization.test.js`, `apps-script/src/tests/TestPerfInvestigation.gs` |

---

## Bottom line

The statement **“Apps Script is slow because it scans all 200 employees”** is **not true** for this codebase.

What is true:

- Reading 200 employee rows for directory, payroll, and leave name maps is **appropriate** and cheap.
- Latency comes from **many spreadsheet-backed RPCs**, **`openById` per RPC**, and **row-by-row writes** (especially payroll).
- Optimize `DbService` batching and a few fat APIs.
- Keep one Google Sheet.
- Do not split by vertical unless a later, measured history problem appears — and then split by **time**, not by company vertical.
