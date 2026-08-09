#!/usr/bin/env python3
"""Generate the frozen participant-facing protocol assets for the study build."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path

from PIL import Image
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as pdf_canvas
from reportlab.platypus import (
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = Path(
    os.environ.get("STUDY_ASSET_SOURCE_ROOT", Path.home() / "Desktop" / "All_info")
).expanduser()
PROTOCOL_DIR = ROOT / "public" / "study" / "protocol"
FORMS_DIR = ROOT / "public" / "study" / "forms"

PIS_VERSION = "PIS-2026-08-09-v1"
PIS_OUTPUT = PROTOCOL_DIR / "participant-information-sheet-v1.0.pdf"
PIS_PREVIEW_PREFIX = PROTOCOL_DIR / "participant-information-sheet-page"
PIS_PREVIEWS = tuple(
    (page, PROTOCOL_DIR / f"participant-information-sheet-page-{page}.png")
    for page in (1, 2)
)

FORMS = (
    (
        "form1.png",
        SOURCE_ROOT / "Form1.png",
        "Participant Intake and Eligibility",
        "https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=yMXEBIzbsUGIK1u3lIQF6D9PZl_aeYNJqeGEWb6Fb8JUOVM4MUlMUTVQT0NMVlUxOUpNSENUSkcwOS4u&origin=QRCode",
    ),
    (
        "form3-quiz.png",
        SOURCE_ROOT / "Form3_Quiz.png",
        "DBI Relational Model — Unaided Quiz",
        "https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=yMXEBIzbsUGIK1u3lIQF6D9PZl_aeYNJqeGEWb6Fb8JUNkpVNlc4RlJTRzFOWktGMVAwWDA0MDFGVi4u&origin=QRCode",
    ),
    (
        "form2.png",
        SOURCE_ROOT / "Form2.png",
        "Post-Learning Questionnaire",
        "https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=yMXEBIzbsUGIK1u3lIQF6D9PZl_aeYNJqeGEWb6Fb8JUODcxODBLNkJLNjBNQUJPRDFISDZXNVZKMC4u&origin=QRCode",
    ),
)


def cjk_font_path() -> Path:
    configured = os.environ.get("STUDY_CJK_FONT")
    candidates = [
        Path(configured).expanduser() if configured else None,
        Path("/Library/Fonts/Arial Unicode.ttf"),
        Path("/System/Library/Fonts/Supplemental/Arial Unicode.ttf"),
        Path("/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttf"),
    ]
    for candidate in candidates:
        if candidate and candidate.is_file():
            return candidate
    raise FileNotFoundError(
        "No embeddable CJK TTF font found. Set STUDY_CJK_FONT to a Unicode TTF file."
    )


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def page_footer(canvas, document) -> None:
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor("#D7DEE8"))
    canvas.line(24 * mm, 15 * mm, A4[0] - 24 * mm, 15 * mm)
    canvas.setFillColor(colors.HexColor("#64748B"))
    canvas.setFont("Helvetica", 8)
    canvas.drawString(24 * mm, 10 * mm, PIS_VERSION)
    canvas.drawRightString(
        A4[0] - 24 * mm,
        10 * mm,
        f"Page {document.page}",
    )
    canvas.restoreState()


def invariant_canvas(*args, **kwargs):
    """Produce byte-for-byte reproducible PDFs for frozen asset hashes."""
    kwargs["invariant"] = 1
    return pdf_canvas.Canvas(*args, **kwargs)


def generate_pis() -> None:
    PROTOCOL_DIR.mkdir(parents=True, exist_ok=True)
    # Embed a real Unicode font subset so the Chinese page renders identically
    # in Chromium, Preview, and Poppler without relying on a local CMap pack.
    pdfmetrics.registerFont(
        TTFont("ArialUnicodeMS", str(cjk_font_path()))
    )

    styles = getSampleStyleSheet()
    title = ParagraphStyle(
        "Title",
        parent=styles["Title"],
        fontName="Helvetica-Bold",
        fontSize=19,
        leading=23,
        alignment=TA_CENTER,
        textColor=colors.HexColor("#0F172A"),
        spaceAfter=9 * mm,
    )
    project = ParagraphStyle(
        "Project",
        parent=styles["BodyText"],
        fontName="Helvetica-Bold",
        fontSize=10.5,
        leading=15,
        textColor=colors.HexColor("#1E3A5F"),
        spaceAfter=5 * mm,
    )
    body = ParagraphStyle(
        "Body",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=9.6,
        leading=14.2,
        textColor=colors.HexColor("#1F2937"),
        spaceAfter=4 * mm,
    )
    contact = ParagraphStyle(
        "Contact",
        parent=body,
        fontSize=9.2,
        leading=13.2,
        spaceAfter=1.2 * mm,
    )
    cn_title = ParagraphStyle(
        "CnTitle",
        parent=title,
        fontName="ArialUnicodeMS",
        fontSize=20,
        leading=25,
    )
    cn_project = ParagraphStyle(
        "CnProject",
        parent=project,
        fontName="ArialUnicodeMS",
        fontSize=11,
        leading=17,
    )
    cn_body = ParagraphStyle(
        "CnBody",
        parent=body,
        fontName="ArialUnicodeMS",
        fontSize=10.2,
        leading=17.2,
        spaceAfter=4.5 * mm,
    )
    cn_contact = ParagraphStyle(
        "CnContact",
        parent=cn_body,
        fontSize=9.8,
        leading=15.2,
        spaceAfter=1.5 * mm,
    )

    doc = SimpleDocTemplate(
        str(PIS_OUTPUT),
        pagesize=A4,
        rightMargin=24 * mm,
        leftMargin=24 * mm,
        topMargin=20 * mm,
        bottomMargin=22 * mm,
        title="Participant Information Sheet",
        author="AI-PPT Tutor Research Team",
        subject="Participant information for the AI-PPT Tutor study",
    )

    story = [
        Paragraph("Participant Information Sheet", title),
        Paragraph(
            "Project Title: Grounded and Attributed AI Tutoring: A 2×2 Factorial Study of Learning Experience and Learning Outcomes",
            project,
        ),
        Paragraph("Dear Participant,", body),
        Paragraph(
            "Thank you for agreeing to participate in this questionnaire survey in connection with my research at the University of Nottingham Ningbo China. The project is a study of how two AI tutoring features — grounding answers in slide content and displaying verifiable sources — shape learners' experience and performance.",
            body,
        ),
        Paragraph(
            "Your participation in the survey is voluntary. You are able to withdraw from the survey at any time and to request that the information you have provided is not used in the project prior the completion of the data processing. Any information provided will be confidential. Your identity will not be disclosed in any use of the information you have supplied during the survey.",
            body,
        ),
        Paragraph(
            "The research project has been reviewed according to the ethical review processes in place in the University of Nottingham Ningbo China. These processes are governed by the University’s Code of Research Conduct and Research Ethics. Should you have any question now or in the future, please contact me or my supervisor. Should you have concerns related to my conduct of the survey or research ethics, please contact my supervisor or the University’s Research Integrity and Ethics Committee.",
            body,
        ),
        Paragraph("Yours truly,<br/>Lijie Zheng", body),
        Spacer(1, 1.5 * mm),
        Paragraph("<b>Contact details</b>", project),
        Paragraph("<b>Student Researchers</b>", contact),
        Paragraph('Luocheng Xie — <link href="mailto:scylx3@nottingham.edu.cn" color="#1D4ED8">scylx3@nottingham.edu.cn</link>', contact),
        Paragraph('Bingxu Hou — <link href="mailto:scybh2@nottingham.edu.cn" color="#1D4ED8">scybh2@nottingham.edu.cn</link>', contact),
        Paragraph('Lijie Zheng — <link href="mailto:Lijie.ZHENG@nottingham.edu.cn" color="#1D4ED8">Lijie.ZHENG@nottingham.edu.cn</link>', contact),
        Paragraph("<b>Supervisor</b>", contact),
        Paragraph('Boon Giin Lee — <link href="mailto:BOON-GIIN.LEE@nottingham.edu.cn" color="#1D4ED8">BOON-GIIN.LEE@nottingham.edu.cn</link>', contact),
        Paragraph("<b>University Research Integrity and Ethics Committee Coordinator</b>", contact),
        Paragraph('Ms Joanna Huang — <link href="mailto:Joanna.Huang@nottingham.edu.cn" color="#1D4ED8">Joanna.Huang@nottingham.edu.cn</link>', contact),
        PageBreak(),
        Paragraph("声明", cn_title),
        Paragraph("论文题目：AI-PPT Tutor 学习体验与学习成果 2×2 因子实验研究", cn_project),
        Paragraph("尊敬的参与者：", cn_body),
        Paragraph(
            "谢谢您参与这次问卷调查。这次问卷调查是我在宁波诺丁汉大学研究相联系的。研究题目是《AI辅导的两项功能——将答案与幻灯片内容联系起来以及显示可验证的来源——如何影响学习者的体验和表现》。",
            cn_body,
        ),
        Paragraph(
            "您是自愿参与此次问卷调查的。您可以在任何时候选择放弃这次的问卷调查，并在数据处理流程前要求您提供的信息不被使用在此次调查中。您提供的所有信息都是保密的。在使用您提供的信息时不会涉及您的身份以及个人信息。",
            cn_body,
        ),
        Paragraph(
            "宁波诺丁汉大学已根据研究道德检查程序对这项研究项目进行检查。这一程序是在学校关于科研行为和伦理道德的行为标准的指导下进行的。如果您现在或将来有任何疑问，请联系本人或我的导师。如果您对我在问卷中的研究行为或研究道德有任何质疑，请联系我的导师或者宁波诺丁汉大学的科研诚信与伦理道德委员会。",
            cn_body,
        ),
        Paragraph("Lijie Zheng", cn_body),
        Spacer(1, 2 * mm),
        Paragraph("联系方式", cn_project),
        Paragraph("研究员：", cn_contact),
        Paragraph('谢罗成 — <link href="mailto:scylx3@nottingham.edu.cn" color="#1D4ED8">scylx3@nottingham.edu.cn</link>', cn_contact),
        Paragraph('侯炳旭 — <link href="mailto:scybh2@nottingham.edu.cn" color="#1D4ED8">scybh2@nottingham.edu.cn</link>', cn_contact),
        Paragraph('郑力杰 — <link href="mailto:Lijie.ZHENG@nottingham.edu.cn" color="#1D4ED8">Lijie.ZHENG@nottingham.edu.cn</link>', cn_contact),
        Paragraph("导师：", cn_contact),
        Paragraph('Boon Giin Lee — <link href="mailto:BOON-GIIN.LEE@nottingham.edu.cn" color="#1D4ED8">BOON-GIIN.LEE@nottingham.edu.cn</link>', cn_contact),
        Paragraph("宁波诺丁汉大学科研诚信与伦理道德委员会秘书：", cn_contact),
        Paragraph('Ms Joanna Huang — <link href="mailto:Joanna.Huang@nottingham.edu.cn" color="#1D4ED8">Joanna.Huang@nottingham.edu.cn</link>', cn_contact),
    ]

    doc.build(
        story,
        onFirstPage=page_footer,
        onLaterPages=page_footer,
        canvasmaker=invariant_canvas,
    )


def generate_pis_previews() -> None:
    """Render browser-stable page previews from the frozen two-page PDF."""
    pdftoppm = shutil.which("pdftoppm")
    if not pdftoppm:
        raise FileNotFoundError(
            "pdftoppm is required to generate the Safari-safe Information Sheet previews."
        )
    subprocess.run(
        [pdftoppm, "-png", "-r", "200", str(PIS_OUTPUT), str(PIS_PREVIEW_PREFIX)],
        check=True,
    )
    for _page, preview in PIS_PREVIEWS:
        if not preview.is_file():
            raise FileNotFoundError(preview)


def generate_form_images() -> None:
    FORMS_DIR.mkdir(parents=True, exist_ok=True)
    for output_name, source, _title, _url in FORMS:
        if not source.exists():
            raise FileNotFoundError(source)
        output = FORMS_DIR / output_name
        with Image.open(source) as image:
            image.save(output, format="PNG", optimize=True, compress_level=9)


def generate_manifest() -> None:
    assets = {
        "protocolVersion": "AI-PPT-TUTOR-STUDY-PROTOCOL-2026-08-09-v1",
        "informationSheet": {
            "version": PIS_VERSION,
            "path": "/study/protocol/participant-information-sheet-v1.0.pdf",
            "sha256": sha256(PIS_OUTPUT),
            "previews": [],
        },
        "forms": {},
    }
    for page, preview in PIS_PREVIEWS:
        with Image.open(preview) as image:
            width, height = image.size
        assets["informationSheet"]["previews"].append(
            {
                "page": page,
                "path": f"/study/protocol/{preview.name}",
                "sha256": sha256(preview),
                "width": width,
                "height": height,
            }
        )
    for output_name, _source, title, url in FORMS:
        output = FORMS_DIR / output_name
        assets["forms"][output_name] = {
            "title": title,
            "path": f"/study/forms/{output_name}",
            "url": url,
            "sha256": sha256(output),
        }

    manifest = PROTOCOL_DIR / "manifest.json"
    manifest.write_text(json.dumps(assets, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> None:
    generate_pis()
    generate_pis_previews()
    generate_form_images()
    generate_manifest()
    print(f"Generated {PIS_OUTPUT.relative_to(ROOT)}")
    for _page, preview in PIS_PREVIEWS:
        print(f"Generated {preview.relative_to(ROOT)}")
    for output_name, *_rest in FORMS:
        print(f"Generated {(FORMS_DIR / output_name).relative_to(ROOT)}")
    print(f"Generated {(PROTOCOL_DIR / 'manifest.json').relative_to(ROOT)}")


if __name__ == "__main__":
    main()
