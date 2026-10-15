#!/usr/bin/env python3
"""Generate sample offer and appointment letter PDFs for recruitment module."""

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

OUT_DIR = Path(__file__).resolve().parents[1] / "docs" / "samples" / "recruitment-letters"


def build_styles():
    base = getSampleStyleSheet()
    styles = {
        "company": ParagraphStyle(
            "company",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=14,
            textColor=colors.HexColor("#1a5f4a"),
            spaceAfter=2,
        ),
        "tagline": ParagraphStyle(
            "tagline",
            parent=base["Normal"],
            fontSize=9,
            textColor=colors.HexColor("#555555"),
            spaceAfter=12,
        ),
        "title": ParagraphStyle(
            "title",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=11,
            spaceBefore=8,
            spaceAfter=10,
        ),
        "body": ParagraphStyle(
            "body",
            parent=base["Normal"],
            fontSize=10,
            leading=14,
            alignment=TA_JUSTIFY,
            spaceAfter=8,
        ),
        "body_left": ParagraphStyle(
            "body_left",
            parent=base["Normal"],
            fontSize=10,
            leading=14,
            alignment=TA_LEFT,
            spaceAfter=6,
        ),
        "section": ParagraphStyle(
            "section",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=10,
            spaceBefore=6,
            spaceAfter=4,
        ),
        "small": ParagraphStyle(
            "small",
            parent=base["Normal"],
            fontSize=9,
            textColor=colors.HexColor("#666666"),
            spaceAfter=4,
        ),
        "sign": ParagraphStyle(
            "sign",
            parent=base["Normal"],
            fontSize=10,
            spaceBefore=4,
            spaceAfter=2,
        ),
    }
    return styles


def letterhead(story, styles):
    story.append(Paragraph("AyurCentral Wellness Pvt. Ltd.", styles["company"]))
    story.append(
        Paragraph(
            "Registered Office: No. 12, Brigade Road, Bengaluru, Karnataka 560001 | CIN: U74999KA2018PTC112233",
            styles["tagline"],
        )
    )
    story.append(
        Paragraph(
            '<font color="#999999">SAMPLE DOCUMENT — For demonstration only. Not a binding offer.</font>',
            styles["small"],
        )
    )
    story.append(Spacer(1, 6 * mm))


def offer_letter_pdf(path: Path):
    styles = build_styles()
    doc = SimpleDocTemplate(
        str(path),
        pagesize=A4,
        leftMargin=22 * mm,
        rightMargin=22 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
    )
    story = []
    letterhead(story, styles)

    story.append(Paragraph("Date: 15 October 2026", styles["body_left"]))
    story.append(Spacer(1, 4 * mm))
    story.append(Paragraph("To,", styles["body_left"]))
    story.append(Paragraph("<b>Ms. Ananya Sharma</b>", styles["body_left"]))
    story.append(Paragraph("42, 3rd Cross, Indiranagar", styles["body_left"]))
    story.append(Paragraph("Bengaluru – 560038", styles["body_left"]))
    story.append(Spacer(1, 4 * mm))
    story.append(
        Paragraph("<b>Subject: Offer of employment — HR Executive</b>", styles["title"])
    )

    story.append(
        Paragraph(
            "Dear Ananya,",
            styles["body_left"],
        )
    )
    story.append(
        Paragraph(
            "With reference to your application and interviews for the position of "
            "<b>HR Executive</b> in the <b>Human Resources</b> department at "
            "<b>AyurCentral Wellness Pvt. Ltd.</b>, we are pleased to offer you employment "
            "on the terms set out below.",
            styles["body"],
        )
    )

    sections = [
        (
            "1. Position",
            [
                "Designation: HR Executive",
                "Department: Human Resources",
                "Reporting to: Priya Menon, HR Manager",
                "Work location: Bengaluru (Hybrid — 3 days office)",
            ],
        ),
        (
            "2. Date of joining",
            ["Your expected date of joining is <b>03 November 2026</b>, subject to satisfactory "
             "verification of documents and reference checks."],
        ),
        (
            "3. Compensation",
            ["Your Cost to Company (CTC) will be <b>₹ 6,50,000</b> per annum, structured as per "
             "company salary policy. A detailed break-up will be shared at onboarding."],
        ),
        (
            "4. Probation",
            ["You will be on probation for <b>six (6) months</b> from the date of joining. "
             "Confirmation will depend on performance and conduct satisfactory to the company."],
        ),
        (
            "5. Terms",
            [
                "Please confirm acceptance by <b>22 October 2026</b>.",
                "You must submit identity, address, education, and prior employment proofs as per the joining checklist.",
                "Employment is governed by company policies and applicable laws, as amended from time to time.",
            ],
        ),
    ]
    for heading, bullets in sections:
        story.append(Paragraph(heading, styles["section"]))
        for line in bullets:
            story.append(Paragraph(f"• {line}", styles["body"]))

    story.append(Spacer(1, 6 * mm))
    story.append(Paragraph("We look forward to welcoming you to AyurCentral.", styles["body"]))
    story.append(Spacer(1, 8 * mm))
    story.append(Paragraph("Yours sincerely,", styles["sign"]))
    story.append(Paragraph("<b>Rajesh Kumar</b>", styles["sign"]))
    story.append(Paragraph("Director — Human Resources", styles["sign"]))
    story.append(Paragraph("AyurCentral Wellness Pvt. Ltd.", styles["sign"]))

    story.append(Spacer(1, 10 * mm))
    story.append(Paragraph("<b>Acceptance by candidate</b>", styles["section"]))
    story.append(
        Paragraph(
            "I, Ananya Sharma, accept the offer on the terms stated above.",
            styles["body"],
        )
    )
    t = Table(
        [["Signature: _________________________", "Date: _________________________"]],
        colWidths=[85 * mm, 85 * mm],
    )
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 12)]))
    story.append(t)

    doc.build(story)


def appointment_letter_pdf(path: Path):
    styles = build_styles()
    doc = SimpleDocTemplate(
        str(path),
        pagesize=A4,
        leftMargin=22 * mm,
        rightMargin=22 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
    )
    story = []
    letterhead(story, styles)

    story.append(Paragraph("Date: 03 November 2026", styles["body_left"]))
    story.append(Spacer(1, 4 * mm))
    story.append(Paragraph("To,", styles["body_left"]))
    story.append(Paragraph("<b>Ms. Ananya Sharma</b>", styles["body_left"]))
    story.append(Paragraph("Employee ID: AC-HR-1047", styles["body_left"]))
    story.append(Paragraph("42, 3rd Cross, Indiranagar, Bengaluru – 560038", styles["body_left"]))
    story.append(Spacer(1, 4 * mm))
    story.append(
        Paragraph("<b>Subject: Letter of appointment — HR Executive</b>", styles["title"])
    )

    story.append(Paragraph("Dear Ananya,", styles["body_left"]))
    story.append(
        Paragraph(
            "Further to your acceptance of our offer dated <b>15 October 2026</b>, we are pleased "
            "to appoint you as <b>HR Executive</b> in the <b>Human Resources</b> department of "
            "<b>AyurCentral Wellness Pvt. Ltd.</b>, with effect from <b>03 November 2026</b>.",
            styles["body"],
        )
    )

    sections = [
        (
            "1. Employment details",
            [
                "Designation: HR Executive",
                "Department: Human Resources",
                "Reporting to: Priya Menon, HR Manager",
                "Employment type: Full-time, Permanent",
                "Place of work: Bengaluru",
            ],
        ),
        (
            "2. Compensation",
            ["Remuneration shall be as per the salary structure communicated to you, totalling "
             "<b>₹ 6,50,000</b> CTC per annum, subject to statutory deductions."],
        ),
        (
            "3. Probation",
            ["Probation period: <b>six (6) months</b> from 03 November 2026. During probation, "
             "either party may terminate with <b>fifteen (15) days</b> notice or salary in lieu, "
             "unless otherwise required by law."],
        ),
        (
            "4. Notice period",
            ["Upon confirmation, termination by either party requires <b>thirty (30) days</b> "
             "written notice or payment in lieu, as per company policy."],
        ),
        (
            "5. Duties and policies",
            [
                "You will perform duties assigned by the company and comply with confidentiality, "
                "code of conduct, and all applicable policies.",
                "This appointment is subject to verification of documents submitted at joining.",
            ],
        ),
        (
            "6. Leave and benefits",
            ["You will be entitled to leave and benefits as per policies applicable to your grade and location."],
        ),
    ]
    for heading, bullets in sections:
        story.append(Paragraph(heading, styles["section"]))
        for line in bullets:
            story.append(Paragraph(f"• {line}", styles["body"]))

    story.append(Spacer(1, 6 * mm))
    story.append(
        Paragraph(
            "Please sign the duplicate copy of this letter as acknowledgement.",
            styles["body"],
        )
    )
    story.append(Spacer(1, 8 * mm))
    story.append(Paragraph("Yours faithfully,", styles["sign"]))
    story.append(Paragraph("<b>Rajesh Kumar</b>", styles["sign"]))
    story.append(Paragraph("Director — Human Resources", styles["sign"]))
    story.append(Paragraph("AyurCentral Wellness Pvt. Ltd.", styles["sign"]))

    story.append(Spacer(1, 10 * mm))
    story.append(Paragraph("<b>Acknowledgement</b>", styles["section"]))
    story.append(
        Paragraph(
            "I have read and understood the terms of this appointment letter and accept the same.",
            styles["body"],
        )
    )
    t = Table(
        [
            ["Employee name: Ananya Sharma", ""],
            ["Signature: _________________________", "Date: _________________________"],
        ],
        colWidths=[85 * mm, 85 * mm],
    )
    t.setStyle(
        TableStyle(
            [
                ("SPAN", (0, 0), (1, 0)),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 1), (-1, 1), 12),
            ]
        )
    )
    story.append(t)

    doc.build(story)


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    offer_path = OUT_DIR / "sample-offer-letter.pdf"
    appt_path = OUT_DIR / "sample-appointment-letter.pdf"
    offer_letter_pdf(offer_path)
    appointment_letter_pdf(appt_path)
    print(offer_path)
    print(appt_path)


if __name__ == "__main__":
    main()
