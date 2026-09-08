# Notification Center — integration notes

The Notification Center is implemented under `apps-script/src/notifications/`. Leave, Payroll, PMS, and ATS are **not** rewritten in this stream. Wire adapters after those modules finish their business commits (never inside `LockService`).

Existing sheet **`Notifications`** remains the **email delivery log** (`02_DATABASE_SCHEMA.md`: PENDING / SENT / FAILED). In-app unread/read lives on new sheets.

---

## 1. New sheets (not registered in SchemaService yet)

| Sheet | Purpose | PK |
| --- | --- | --- |
| `NotificationInbox` | In-app center | `notification_id` |
| `NotificationPreferences` | Per employee × type | `preference_id` |

`NotificationSchema.ensureSheets()` creates them on first use (idempotent; appends missing headers only).

**DbService:** no new methods. Use `getAllRecords` / `insertRecord` / `insertRecords` / `updateRecord` with the sheet names above.

**Optional one-line registry** (integration agent, not required to run):

`apps-script/src/foundation/Constants.gs` inside `HRMS.SHEETS`:

```javascript
NOTIFICATION_INBOX: 'NotificationInbox',
NOTIFICATION_PREFERENCES: 'NotificationPreferences'
```

`SchemaService.gs` `SHEET_HEADERS_`:

```javascript
SHEET_HEADERS_['NotificationInbox'] = [ /* NotificationSchema.INBOX_HEADERS */ ];
SHEET_HEADERS_['NotificationPreferences'] = [ /* NotificationSchema.PREF_HEADERS */ ];
```

If you add those sheets to `SchemaService.getSchemaInfo()`, update `TestFoundation.gs` expected sheet count (currently 14). Prefer calling `NotificationSchema.ensureSheets()` from `apiRunDatabaseSetup` after `SchemaService.setupDatabase` instead of expanding the locked 14-sheet list until you are ready.

---

## 2. Shell drop-in (do not skip)

**Do not** rely on this stream’s edits to `Index.html` / `Scripts.html` / `Styles.html` / `PermissionService.gs` / `ApiFoundation.gs`. Apply the following.

### 2.1 Bell in the header

In `ui/Index.html`, inside `.header-right`, **before** `.user-chip`:

```html
<div id="ntf-bell-slot"></div>
```

Before `<?!= include('ui/Scripts'); ?>` (or immediately after Styles):

```html
<?!= include('notifications/NotificationBell'); ?>
```

The bell self-mounts on `#ntf-bell-slot`, polls unread count, marks read, and calls `HrmsApp.navigate(route, params)`.

### 2.2 Lazy-load the full page

`foundation/ApiFoundation.gs` — add to `HRMS_MODULE_UI_FILES_`:

```javascript
notifications: ['notifications/NotificationClient', 'notifications/NotificationBell']
```

(`NotificationBell` may be omitted here if it is already included in Index.)

`ui/Scripts.html`:

- `ROUTE_MODULE.notifications = 'notifications'`
- `ROUTE_TITLES.notifications = 'Notifications'`
- `ROUTE_LEDES.notifications = 'Your inbox and, for HR, the email delivery log.'`

### 2.3 Nav placeholder

`PermissionService.gs` nav item `notifications`: set `placeholder: false` (or remove `placeholder`). Keep roles `ADMIN` / `HR` for the **page** (email log + announce). **All roles** still use the bell; inbox APIs require only `ACCESS_APP` and are recipient-scoped.

Employees/managers without the nav item still open the bell. “View all” navigates to `notifications`; if that route is hidden, the inbox in the panel is enough.

### 2.4 Optional setup hook

`apiRunDatabaseSetup` / `menuRunDatabaseSetup` after `SchemaService.setupDatabase`:

```javascript
if (typeof NotificationSchema !== 'undefined') NotificationSchema.ensureSheets();
```

---

## 3. How existing modules should call the service

Always **after** the spreadsheet commit and **outside** `withScriptLock_`. Wrap in try/catch so notification failure never rolls back leave or payroll (same rule as `07`).

### Leave (`LeaveService.gs`)

Replace or supplement `notifyLeave_` **after** lock release:

| Event | Call | Recipients |
| --- | --- | --- |
| Submit | `NotificationLeaveAdapter.notifySubmitted(request, employee, manager)` | Manager |
| Approve | `NotificationLeaveAdapter.notifyApproved(request, employee)` | Employee |
| Reject | `NotificationLeaveAdapter.notifyRejected(request, employee)` | Employee |
| Cancel | `NotificationLeaveAdapter.notifyCancelled(request, employee, manager, actorName)` | Employee; manager if previous status was `SUBMITTED` |

Suggested sites (do not apply here): after `notifyLeave_(...)` in `submit` / `approve` / `reject`; after cancel lock in `cancel` (no email today).

Until wired, Leave continues to write the **email log** via `notifyLeave_`. The adapter writes **inbox + optional email** (org setting `notification_leave`, user prefs). After wiring, remove duplicate MailApp from `notifyLeave_` or keep log-only to avoid two emails.

### Payroll (`PayrollService.gs`)

| Event | Call | When |
| --- | --- | --- |
| → `UNDER_REVIEW` | `NotificationPayrollAdapter.notifyReadyForReview(run)` | After `submitForReview` lock |
| → `APPROVED` | `NotificationPayrollAdapter.notifyApproved(run)` | After `approve` lock |
| → `LOCKED` | `NotificationPayrollAdapter.notifyLocked(run)` | After lock status flip (optional HR/Admin) |
| Payslips | `NotificationPayrollAdapter.notifyPayslipsAvailable(run, records, employeeMap)` | **After** payslip Drive generation, never inside the lock |

Payslip subjects use `NotificationEngine.payslipSubject(year, month)` — **no net pay**.

Large lock: adapter batches inbox inserts then sends up to 40 emails; remainder stay `email_status=PENDING`. Drain with `runNotificationDailyJob` / `NotificationService.processPendingEmails`.

### PMS (future)

```javascript
NotificationPmsAdapter.notifyCycleOpen(cycle, recipients);
NotificationPmsAdapter.notifySelfAssessmentDue(cycle, employee);
NotificationPmsAdapter.notifyManagerReviewPending(cycle, manager, employeeDisplayName);
NotificationPmsAdapter.notifyFinalized(cycle, employee);
```

Routes `pms-cycle` / `pms-self` / `pms-review` are placeholders until PMS UI exists.

### ATS (future)

Internal (HRMS users only):

```javascript
NotificationAtsAdapter.notifyNewApplication(application, hrRecipients);
NotificationAtsAdapter.notifyShortlisted(application, hrRecipients);
NotificationAtsAdapter.notifyInterviewScheduled(application, interviewers);
NotificationAtsAdapter.notifyFeedbackPending(application, interviewers);
NotificationAtsAdapter.notifySelected(application, hrRecipients);
```

Candidate email (no inbox row, no HRMS URL, no `employee_id`):

```javascript
NotificationAtsAdapter.notifyCandidate('ATS_CANDIDATE_APPLICATION', candidate);
NotificationAtsAdapter.notifyCandidate('ATS_CANDIDATE_INTERVIEW', candidate, { interview_at: '…' });
NotificationAtsAdapter.notifyCandidate('ATS_CANDIDATE_UPDATE', candidate);
```

---

## 4. Birthday / work anniversary trigger

Editor or future `Main.gs` menu (do not add blindly):

```javascript
installNotificationDailyTrigger();  // 06:00 Asia/Kolkata, handler runNotificationDailyJob
```

Admin RPC: `apiRunNotificationDailyJob` (`RUN_SETUP` / ADMIN).

The job:

1. ACTIVE employees whose `date_of_birth` / `joining_date` match today (timezone from Settings; 29 Feb → 28 Feb in non-leap years).
2. Work anniversary skipped in the **joining year**.
3. Dedupe per employee per calendar year.
4. Drains pending payslip emails.

Default: in-app on, email off.

---

## 5. Client RPCs

| Function | Who |
| --- | --- |
| `apiGetNotifications` | Self inbox |
| `apiGetUnreadNotificationCount` | Self |
| `apiGetNotificationBellState` | Self (8 latest + count) |
| `apiMarkNotificationRead` | Own rows only |
| `apiMarkAllNotificationsRead` | Own rows only |
| `apiGetNotificationPreferences` / `apiSaveNotificationPreferences` | Self |
| `apiCreateHrAnnouncement` | HR / ADMIN |
| `apiListNotificationEmailLog` / `apiRetryNotificationEmail` | HR / ADMIN |
| `apiEnsureNotificationSchema` / `apiRunNotificationDailyJob` | ADMIN (`RUN_SETUP`) |

Server (modules, not `google.script.run`):

`NotificationService.createNotification` / `createNotifications` / `getNotifications` / `getUnreadCount` / `markNotificationRead` / `markAllNotificationsRead`

---

## 6. Shared files this stream did **not** change

`Main.gs`, `ApiFoundation.gs`, `PermissionService.gs`, `AuthService.gs`, `AuthSessionService.gs`, `DbService.gs`, `ConfigService.gs`, `Constants.gs`, `SchemaService.gs`, `Index.html`, `Scripts.html`, `Styles.html`, Employee / Leave / Payroll / Ask HR.

Dashboard can later call `NotificationService.countFailedEmails()` for the failed-email KPI (`07`).

---

## 7. Tests

```text
node tests/notification-engine.test.js
```

Apps Script editor: `testNotifications_All` (engine always; sheet smoke if `HRMS_SPREADSHEET_ID` is set).
