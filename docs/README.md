# HRMS documentation artifacts

## AyurCentral user manuals (latest)

| File | Who should read it |
|------|-------------------|
| **[AYURCENTRAL_HR_USER_MANUAL.md](./AYURCENTRAL_HR_USER_MANUAL.md)** | **Share with HR** — step-by-step web app guide (screens only, simple English). |
| **[AYURCENTRAL_TECHNICAL_GUIDE_FOR_ADMIN.md](./AYURCENTRAL_TECHNICAL_GUIDE_FOR_ADMIN.md)** | **System owner / developer** — deploy, payroll verticals, APIs, troubleshooting. |

---

| File | Description |
|------|-------------|
| **HRMS_FULL_DOCUMENTATION.pdf** | **Main operator PDF** — modules, leave workflow, data index, **Appendix A** (every repo `.md` doc explained), **Appendix B** (every Apps Script file → module & feature) |
| **HRMS_FULL_DOCUMENTATION.md** | Source for the PDF (edit this, then run `python3 build-full-doc-pdf.py`) |
| **HRMS_FULL_DOCUMENTATION.html** | HTML export (intermediate for PDF) |
| **build-full-doc-pdf.py** | Regenerates HTML + PDF from the markdown |

Other docs live in the repo root (`00_MASTER_SPEC.md` … `12_BUILD_PLAN.md`) and in this folder (`ATS_INTEGRATION_NOTES.md`, etc.) — all listed in Appendix A of the PDF.
