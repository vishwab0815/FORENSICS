"""Job status, results, evidence files and forensic report download."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import get_current_user_optional
from app.models import Job, JobStatus, Report, User
from app.report.generator import generate_report
from app.schemas import RESULT_DISCLAIMER, JobResultOut, JobStatusOut, ReportOut

router = APIRouter(prefix="/jobs", tags=["jobs"])


def _get_job(job_id: str, db: Session, user: User | None) -> Job:
    """Fetch a job, enforcing ownership.

    A job created by a signed-in user is readable only by that user. Guest jobs
    have no owner, so they stay readable by anyone holding the unguessable job
    id — which is what lets a guest see their own result without an account.
    """
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found.")
    if job.user_id is not None and (user is None or user.id != job.user_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Job not found.",  # same message: do not confirm the id exists
        )
    return job


@router.get("/{job_id}/status", response_model=JobStatusOut)
def job_status(
    job_id: str,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_current_user_optional),
) -> Job:
    """Poll a job's lifecycle state: queued / processing / done / failed."""
    return _get_job(job_id, db, user)


@router.get("/{job_id}/result", response_model=JobResultOut)
def job_result(
    job_id: str,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_current_user_optional),
) -> JobResultOut:
    """Return the verdict, confidence and supporting evidence for a finished job."""
    job = _get_job(job_id, db, user)
    if job.status is JobStatus.FAILED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=job.error_message or "Analysis failed.",
        )
    if job.status is not JobStatus.DONE:
        raise HTTPException(
            status_code=status.HTTP_425_TOO_EARLY,
            detail=f"Job is {job.status.value}; poll /status until it is done.",
        )

    evidence = dict(job.evidence or {})
    # Rewrite bare filenames into URLs the browser can load.
    if evidence.get("heatmap_file"):
        evidence["heatmap_url"] = f"{settings.api_v1_prefix}/jobs/{job.id}/evidence/heatmap"
    if evidence.get("spectrogram_file"):
        evidence["spectrogram_url"] = f"{settings.api_v1_prefix}/jobs/{job.id}/evidence/spectrogram"

    payload = JobResultOut.model_validate(job, from_attributes=True)
    return payload.model_copy(update={"evidence": evidence, "disclaimer": RESULT_DISCLAIMER})


@router.get("/{job_id}/evidence/{kind}")
def job_evidence(
    job_id: str,
    kind: str,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_current_user_optional),
) -> FileResponse:
    """Serve a generated evidence image (Grad-CAM heatmap or spectrogram)."""
    job = _get_job(job_id, db, user)
    key = {"heatmap": "heatmap_file", "spectrogram": "spectrogram_file"}.get(kind)
    if key is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown evidence type.")

    filename = (job.evidence or {}).get(key)
    if not filename:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"No {kind} was produced for this job."
        )

    # Resolve inside the evidence directory so a crafted name cannot escape it.
    evidence_root = Path(settings.evidence_dir).resolve()
    path = (evidence_root / Path(filename).name).resolve()
    if not str(path).startswith(str(evidence_root)) or not path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Evidence file missing.")

    return FileResponse(path, media_type="image/png", filename=path.name)


@router.post("/{job_id}/report", response_model=ReportOut, status_code=status.HTTP_201_CREATED)
def create_report(
    job_id: str,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_current_user_optional),
) -> ReportOut:
    """Generate the forensic PDF report for a completed job."""
    job = _get_job(job_id, db, user)
    if job.status is not JobStatus.DONE:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A report can only be generated for a completed analysis.",
        )

    artifacts = generate_report(job, requester=user.email if user else None)

    # The reference is derived from the case id, so regenerating rewrites the
    # same file: update that record rather than inserting a duplicate whose
    # hash no longer matches the PDF now on disk.
    report = _find_by_reference(db, artifacts.report_reference)
    if report is None:
        report = Report(job_id=job.id, report_reference=artifacts.report_reference)
        db.add(report)
    report.file_path = str(artifacts.path)
    report.sha256 = artifacts.sha256
    report.generated_at = artifacts.generated_at
    db.commit()
    db.refresh(report)

    return _to_report_out(report)


def _find_by_reference(db: Session, report_reference: str) -> Report | None:
    return db.scalar(select(Report).where(Report.report_reference == report_reference))


@router.get("/{job_id}/report")
def download_report(
    job_id: str,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_current_user_optional),
) -> FileResponse:
    """Download the latest PDF report, generating one if none exists yet."""
    job = _get_job(job_id, db, user)
    if job.status is not JobStatus.DONE:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A report can only be generated for a completed analysis.",
        )

    report = job.reports[-1] if job.reports else None
    if report is None or not Path(report.file_path).exists():
        created = create_report(job_id, db=db, user=user)
        report = _find_by_reference(db, created.report_reference)

    return FileResponse(
        report.file_path,
        media_type="application/pdf",
        filename=f"{report.report_reference}.pdf",
        headers={"X-Report-SHA256": report.sha256},
    )


def _to_report_out(report: Report) -> ReportOut:
    return ReportOut(
        id=report.id,
        job_id=report.job_id,
        report_reference=report.report_reference,
        sha256=report.sha256,
        generated_at=report.generated_at,
        download_url=f"{settings.api_v1_prefix}/jobs/{report.job_id}/report",
    )
