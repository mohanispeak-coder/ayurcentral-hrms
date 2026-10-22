#!/usr/bin/env python3
"""Build PDF (and HTML) for AyurCentral HR manuals from markdown."""
import pathlib
import subprocess
import sys
import time

try:
    import markdown
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "markdown", "-q"])
    import markdown

ROOT = pathlib.Path(__file__).resolve().parent
CHROME = "/usr/local/bin/google-chrome"

CSS = """
@page { margin: 18mm 14mm; }
body { font-family: 'Segoe UI', system-ui, sans-serif; font-size: 11pt; line-height: 1.45; color: #1e293b; max-width: 210mm; margin: 0 auto; padding: 12px; }
h1 { font-size: 22pt; border-bottom: 2px solid #0f766e; padding-bottom: 8px; color: #0f766e; }
h2 { font-size: 14pt; margin-top: 1.4em; color: #134e4a; page-break-after: avoid; }
h3 { font-size: 12pt; margin-top: 1em; page-break-after: avoid; }
table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 9.5pt; page-break-inside: avoid; }
th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; vertical-align: top; }
th { background: #f1f5f9; font-weight: 600; }
tr:nth-child(even) td { background: #f8fafc; }
code { background: #f1f5f9; padding: 1px 4px; border-radius: 3px; font-size: 9pt; }
hr { border: none; border-top: 1px solid #e2e8f0; margin: 1.5em 0; }
ul, ol { margin: 0.4em 0; }
p { margin: 0.5em 0; }
li { margin: 0.2em 0; }
"""

MANUALS = [
    ("AYURCENTRAL_HR_USER_MANUAL.md", "AyurCentral HRMS - HR User Manual"),
    ("AYURCENTRAL_TECHNICAL_GUIDE_FOR_ADMIN.md", "AyurCentral HRMS - Technical Guide (Admin)"),
]


def build_one(md_name: str, title: str) -> None:
    md_path = ROOT / md_name
    if not md_path.is_file():
        raise SystemExit(f"Missing {md_path}")
    base = md_path.stem
    html_path = ROOT / f"{base}.html"
    pdf_path = ROOT / f"{base}.pdf"

    md_text = md_path.read_text(encoding="utf-8")
    body = markdown.markdown(md_text, extensions=["tables", "fenced_code", "sane_lists"])
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{title}</title>
<style>{CSS}</style>
</head>
<body>
{body}
</body>
</html>"""
    html_path.write_text(html, encoding="utf-8")

    user_data = ROOT / ".chrome-pdf-profile"
    user_data.mkdir(exist_ok=True)
    cmd = [
        CHROME,
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        f"--user-data-dir={user_data}",
        f"--print-to-pdf={pdf_path}",
        html_path.as_uri(),
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(90):
            if pdf_path.is_file() and pdf_path.stat().st_size > 5000:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                break
            if proc.poll() is not None:
                break
            time.sleep(1)
        else:
            proc.kill()
            raise subprocess.TimeoutExpired(cmd, 90)
    finally:
        if proc.poll() is None:
            proc.kill()
    if not pdf_path.is_file():
        raise SystemExit(f"PDF not created: {pdf_path}")
    print(f"Wrote {html_path.name} ({html_path.stat().st_size // 1024} KB)")
    print(f"Wrote {pdf_path.name} ({pdf_path.stat().st_size // 1024} KB)")


def main():
    for md_name, title in MANUALS:
        build_one(md_name, title)


if __name__ == "__main__":
    main()
