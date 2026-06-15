from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from .. import models, schemas
from ..database import get_db
from .. import security
import csv, io

router = APIRouter(tags=["bug_reports"])


@router.post("/bug_reports", response_model=schemas.BugReportResponse, status_code=201)
def create_bug_report(
    req: Request,
    payload: schemas.BugReportCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    ua = (req.headers.get("user-agent") or "")[:512]
    op_log = (payload.operation_log or "")[:20000] or None
    report = models.BugReport(
        reporter_user_id=current_user.id,
        reporter_name=(current_user.name or current_user.email or f'user#{current_user.id}'),
        title=payload.title[:255],
        description=payload.description,
        severity=payload.severity,
        page_url=(payload.page_url or "")[:1024] or None,
        operation_log=op_log,
        user_agent=ua or None,
        status="open",
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return report


@router.get("/bug_reports/recent", response_model=list[schemas.BugReportRecentItem])
def get_recent_bug_reports(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    return (
        db.query(models.BugReport)
        .order_by(models.BugReport.created_at.desc())
        .limit(5)
        .all()
    )


@router.get("/bug_reports/export.csv")
def export_bug_reports_csv(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_active_admin),
):
    rows = db.query(models.BugReport).order_by(models.BugReport.created_at.desc()).all()
    buf = io.StringIO()
    buf.write('﻿')  # BOM for Excel
    w = csv.writer(buf)
    w.writerow(["id", "created_at", "updated_at", "reporter_user_id", "reporter_name",
                "severity", "status", "title", "description", "page_url", "user_agent", "operation_log"])
    for r in rows:
        w.writerow([r.id, r.created_at, r.updated_at, r.reporter_user_id, r.reporter_name,
                    r.severity, r.status, r.title, r.description, r.page_url, r.user_agent,
                    r.operation_log])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="bug_reports.csv"'},
    )
