# UI Design System and Phase 1 Screens

**Document:** `08_UI_DESIGN_SYSTEM.md`  
**Brand:** Professional HRMS first; Ayurveda second (palette only).

---

## 1. Visual direction

Modern, calm, premium, minimal, warm, trustworthy.

**Use:** Warm ivory page; charcoal text; deep botanical green for **primary actions and active nav only**; sage for muted text; **sparse** terracotta for focus/accent; soft cards; 10–12px radius; light shadow; humanist sans; tabular numbers for money and `employee_id`.

**Avoid:** Wall-to-wall green, lotus, Sanskrit, religious art, heavy texture, decorative leaves, marketing-sized type.

Status badges (same everywhere):

| Domain | Badge |
| --- | --- |
| Leave | DRAFT grey, SUBMITTED amber, APPROVED green, REJECTED clay, CANCELLED muted |
| Payroll | DRAFT grey, CALCULATED sage, UNDER_REVIEW amber, APPROVED green, LOCKED charcoal |
| Employee | ACTIVE green, INACTIVE grey |

---

## 2. Shared components

Sidebar, header (title + user + role), cards, tables (sticky header, 25/page), forms, inputs, dropdowns, employee picker (`employee_id` + name), modals (approve/lock), tabs, badges, buttons (primary / secondary / danger), toasts, alerts, empty/loading, pagination, search, filters, date/month pickers.

One CSS token set. UI Agent owns tokens; modules do not invent new palettes.

---

## 3. Role-based chrome

Nav items **exactly** as `03` §2. Backend still denies unauthorized calls.

---

## 4. Definitive Phase 1 screen list

| Screen name | Module | Purpose | Primary user | Main actions | Data shown |
| --- | --- | --- | --- | --- | --- |
| Dashboard | Dashboard | Attention today | All (variant) | Jump to queues | KPIs, alerts, recent (HR) |
| My Profile | Employee | Own master (permitted) | EMPLOYEE, MANAGER | Edit contact SHOULD | Personal + employment; own salary summary |
| Employee Directory | Employee | Company list | HR, ADMIN | Search, filter, add | Non-salary columns |
| My Team | Employee | Direct reports | MANAGER | Open profile | Team non-salary |
| Employee Create | Employee | New person | HR, ADMIN | Save | Create form |
| Employee Profile | Employee | Full master | HR, ADMIN | Edit, status, upload | Tabs; salary if HR |
| Apply Leave | Leave | New request | Self / HR proxy | Submit / DRAFT | Type, dates, reason |
| My Leave | Leave | Own history | Self | Cancel allowed | Own requests, balances |
| Leave Approvals | Leave | Decide | MANAGER, HR, ADMIN | Approve, reject | Team or all SUBMITTED |
| Leave Admin | Leave | All + types | HR, ADMIN | Filter, types | Requests, LeaveTypes |
| Leave Calendar | Leave | Month view SHOULD | HR / Manager / self | Change month | APPROVED bars |
| Payroll Runs | Payroll | Pick/create month | HR, ADMIN | Create run, open | Runs + status |
| Payroll Run | Payroll | Inputs + workflow | HR, ADMIN | Save inputs, calculate, review, approve, lock | Stepper, table, exceptions |
| Payroll Register | Payroll | Results | HR, ADMIN | View | Snapshot amounts |
| Compensation | Payroll | Structure + revise | HR, ADMIN | Save, revise | Structure + history via superseded rows |
| My Payslips | Payroll | Own files | EMPLOYEE+ | Download | Own PAYSLIP documents |
| Notifications log | Notifications | Failed/sent | HR, ADMIN | Retry SHOULD | Notifications sheet |
| Settings | Config | Company flags | ADMIN (HR read) | Save | Settings keys |
| Users | Roles | Map emails | ADMIN | Assign role, disable | Users |

**Do not add** in Phase 1: analytics studio, holiday admin, attendance, recruitment, tax wizard, org chart.

---

## 5. Layout

Desktop: left sidebar + main. Comfortable spacing (8px scale). Same table/button language on every module.
