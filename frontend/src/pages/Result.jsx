import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, pollJob } from '../lib/api'
import { formatBytes, formatDate, formatDuration, percent, verdictMeta } from '../lib/format'
import AuthedImage from '../components/AuthedImage'
import ConfidenceChart from '../components/ConfidenceChart'
import {
  Card, CopyButton, Field, LoadingState, Notice, ProbabilityMeter, Stat,
} from '../components/ui'
import { ArrowRight, FileText, MEDIA_ICON, Upload } from '../components/ui/Icons'

export default function Result() {
  const { jobId } = useParams()
  const [result, setResult] = useState(null)
  const [status, setStatus] = useState('queued')
  const [error, setError] = useState(null)

  useEffect(() => {
    let active = true
    pollJob(jobId, { onTick: (tick) => active && setStatus(tick.status) })
      .then((payload) => active && setResult(payload))
      .catch((err) => active && setError(err.message))
    return () => { active = false }
  }, [jobId])

  if (error) {
    return (
      <div className="mx-auto max-w-xl animate-in">
        <Card>
          <Notice tone="critical" title="Analysis could not be completed">{error}</Notice>
          <Link to="/analyse" className="btn-secondary mt-4">
            <Upload size={15} /> Try another file
          </Link>
        </Card>
      </div>
    )
  }

  if (!result) {
    return (
      <div className="mx-auto max-w-xl animate-in">
        <Card>
          <LoadingState
            title={status === 'processing' ? 'Analysing your file…' : 'Queued for analysis…'}
            detail="This page updates itself — you do not need to refresh."
          />
        </Card>
      </div>
    )
  }

  const meta = verdictMeta(result.verdict)
  const evidence = result.evidence || {}
  const timeline = evidence.frame_scores || evidence.segment_scores || []
  const MediaIcon = MEDIA_ICON[result.media_type] || FileText
  const untrained = result.weights_status && result.weights_status !== 'trained'

  return (
    <div className="mx-auto max-w-4xl animate-in space-y-5">
      {untrained && (
        <Notice tone="critical" title="Demonstration mode — this score is not evidence">
          No trained model checkpoint is installed on this deployment, so the network is running
          with untrained weights. The score below carries no evidentiary value. Train the
          detectors or install checkpoints before relying on any report from this instance.
        </Notice>
      )}

      {/* ---------------------------------------------------------- verdict */}
      <section className="card overflow-hidden">
        <div className="p-6" style={{ background: meta.bg }}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <span className="mt-0.5 shrink-0" style={{ color: meta.color }}>
                <meta.icon size={32} />
              </span>
              <div>
                <p className="text-[0.6875rem] font-semibold uppercase tracking-wider text-ink-muted">
                  Verdict
                </p>
                <h1 className="mt-0.5 text-[1.75rem] font-bold leading-tight tracking-tight"
                    style={{ color: meta.color }}>
                  {meta.label}
                </h1>
                <p className="mt-1.5 max-w-md text-[0.875rem] leading-relaxed text-ink-secondary">
                  {meta.blurb}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="tnum text-[2.5rem] font-extrabold leading-none tracking-tightest"
                 style={{ color: meta.color }}>
                {percent(result.fake_probability)}
              </p>
              <p className="mt-1 text-[0.75rem] text-ink-muted">probability of manipulation</p>
            </div>
          </div>
        </div>

        <div className="border-t p-6" style={{ borderColor: 'var(--border-subtle)' }}>
          <ProbabilityMeter value={result.fake_probability} />
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Stat label="Decision confidence" value={percent(result.confidence)}
                  hint="Distance from the undecided midpoint" />
            <Stat label="Processing time" value={formatDuration(result.processing_ms)}
                  hint="End to end" />
            <Stat label="Media analysed"
                  value={result.media_type.charAt(0).toUpperCase() + result.media_type.slice(1)}
                  hint={evidence.faces_detected !== undefined
                        ? `${evidence.faces_detected} face(s) detected`
                        : evidence.frames_analysed
                          ? `${evidence.frames_analysed} frames sampled`
                          : `${evidence.segments_analysed || 0} windows`} />
          </div>
          <p className="mt-4 text-[0.75rem] leading-relaxed text-ink-muted">
            A score near 50% means the model cannot separate this file from authentic media. That
            is reported as inconclusive rather than forced into a yes or no.
          </p>
        </div>
      </section>

      {/* ------------------------------------------------------ file details */}
      <Card title="Submitted file"
            subtitle="Recorded at the moment of upload, before any processing">
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          <Field label="Filename">
            <span className="flex items-center gap-2">
              <span className="text-ink-muted"><MediaIcon size={15} /></span>
              <span className="truncate">{result.original_filename}</span>
            </span>
          </Field>
          <Field label="Case reference" mono>{result.case_reference}</Field>
          <Field label="File size">{formatBytes(result.file_size_bytes)}</Field>
          <Field label="Received">{formatDate(result.uploaded_at)}</Field>
          <Field label="Model">
            {result.model_name}
            <span className="mono ml-1.5 text-[0.75rem] text-ink-muted">
              {result.model_version}
            </span>
          </Field>
          <Field label="Weights">
            <span style={{ color: untrained ? 'var(--status-critical)' : 'var(--status-good)' }}>
              {untrained ? 'Untrained — not evidential' : 'Trained checkpoint'}
            </span>
          </Field>
          <Field label="SHA-256 of the analysed file" mono wide>
            <span className="flex items-start gap-2">
              <span className="min-w-0 flex-1">{result.sha256}</span>
              <CopyButton value={result.sha256} />
            </span>
          </Field>
        </dl>
      </Card>

      {/* --------------------------------------------------------- evidence */}
      {(evidence.heatmap_url || evidence.spectrogram_url) && (
        <Card title="Visual evidence"
              subtitle={evidence.heatmap_url
                ? 'Regions that most influenced the model’s decision'
                : 'Frequency content over time, with flagged windows marked'}>
          {evidence.heatmap_url && (
            <figure>
              {/* A face crop is small; framing it keeps it from floating in
                  whitespace and reads as an exhibit rather than a stray image. */}
              <div className="flex justify-center rounded-lg p-5"
                   style={{ background: 'var(--surface-2)' }}>
                <AuthedImage src={api.evidenceUrl(evidence.heatmap_url)}
                             alt="Grad-CAM heatmap over the analysed region"
                             className="max-h-[22rem] rounded-md shadow-md" />
              </div>
              <figcaption className="mt-3 text-[0.75rem] leading-relaxed text-ink-muted">
                Grad-CAM heatmap. Warmer areas contributed most strongly to the decision — on a
                face swap these commonly appear along the jawline, hairline, or the boundary
                where a synthetic face was blended into the original.
              </figcaption>
            </figure>
          )}
          {evidence.spectrogram_url && (
            <figure>
              <AuthedImage src={api.evidenceUrl(evidence.spectrogram_url)}
                           alt="Log-Mel spectrogram with flagged windows outlined"
                           className="w-full rounded-lg" />
              <figcaption className="mt-3 text-[0.75rem] leading-relaxed text-ink-muted">
                Log-Mel spectrogram. Red boxes mark the windows scored as synthetic.
              </figcaption>
            </figure>
          )}
        </Card>
      )}

      {/* --------------------------------------------------------- timeline */}
      {timeline.length > 1 && (
        <Card
          title={evidence.frame_scores ? 'Per-frame confidence' : 'Per-window confidence'}
          subtitle="A manipulation affecting only part of the media appears here as a localised peak"
        >
          <ConfidenceChart points={timeline}
                           unit={evidence.frame_scores ? 'Frame' : 'Window'} />
        </Card>
      )}

      {/* ------------------------------------------------------------ notes */}
      {evidence.notes?.length > 0 && (
        <Card title="Analysis notes">
          <ul className="space-y-2">
            {evidence.notes.map((note) => (
              <li key={note} className="flex gap-2.5 text-[0.8125rem] leading-relaxed text-ink-secondary">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full"
                      style={{ background: 'var(--text-muted)' }} />
                {note}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="flex flex-wrap gap-3">
        <Link to={`/jobs/${jobId}/report`} className="btn-primary btn-lg">
          <FileText size={16} /> Generate forensic report <ArrowRight size={15} />
        </Link>
        <Link to="/analyse" className="btn-secondary btn-lg">
          <Upload size={15} /> Analyse another file
        </Link>
      </div>

      <Notice tone="warn" title="Read this before relying on the result">
        This is an automated technical assessment, not a certified forensic opinion. Detectors
        produce both false positives and false negatives, and accuracy degrades on compressed or
        low-resolution media. For legal proceedings, verification by a certified forensic expert
        is recommended.
      </Notice>
    </div>
  )
}
