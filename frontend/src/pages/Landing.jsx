import { Link } from 'react-router-dom'
import { Card, Notice } from '../components/ui'
import {
  ArrowRight, FileText, Hash, Image, Lock, ShieldCheck, Upload,
} from '../components/ui/Icons'

const CAPABILITIES = [
  {
    icon: Image,
    kind: 'Image',
    detail: 'Detects AI-generated or manipulated face images.',
    evidence: 'Confidence score with a per-region attention heatmap',
  },
]

const STEPS = [
  {
    icon: Upload,
    title: 'Upload',
    body: 'Your file is hashed with SHA-256 the moment it arrives and stored byte-for-byte unchanged.',
  },
  {
    icon: ShieldCheck,
    title: 'Analyse',
    body: 'Neural detectors score the media and produce visual evidence you can inspect yourself.',
  },
  {
    icon: FileText,
    title: 'Report',
    body: 'A timestamped PDF with the file hash, verdict, evidence and a plain-language method note.',
  },
]

const ASSURANCES = [
  { icon: Hash, title: 'Verifiable hashes',
    body: 'Both the analysed file and the report can be checked with a standard shasum command.' },
  { icon: Lock, title: 'Your data stays yours',
    body: 'Results are private to your account, and one click erases a scan and every derived file.' },
  { icon: ShieldCheck, title: 'Calibrated, not absolute',
    body: 'Borderline scores are reported as inconclusive rather than forced into a yes or no.' },
]

export default function Landing() {
  return (
    <div className="space-y-16">
      {/* ------------------------------------------------------------- hero */}
      <section className="animate-in pt-6 text-center sm:pt-12">
        <span className="badge badge-neutral mx-auto">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--accent)' }} />
          Image
        </span>
        <h1 className="mx-auto mt-5 max-w-3xl text-[2.5rem] font-extrabold leading-[1.08]
                       tracking-tightest text-ink-primary sm:text-[3.25rem]">
          Is this image, voice
          <br className="hidden sm:block" /> or video real?
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-[1.0625rem] leading-relaxed text-ink-secondary">
          Upload suspected media and receive a confidence score, visual evidence, and a
          timestamped forensic report you can attach to a cybercrime complaint.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link to="/analyse" className="btn-primary btn-lg">
            Analyse a file <ArrowRight size={16} />
          </Link>
          <Link to="/how-it-works" className="btn-secondary btn-lg">How it works</Link>
        </div>
        <p className="mt-4 text-[0.8125rem] text-ink-muted">
          No account needed to try it — sign in for history and a higher limit.
        </p>
      </section>

      {/* ------------------------------------------------------------ steps */}
      <section>
        <div className="grid gap-4 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <Card key={step.title} className="relative overflow-hidden">
              <span className="absolute right-4 top-3 text-[2.75rem] font-extrabold leading-none
                               tracking-tighter opacity-[0.06]">
                {index + 1}
              </span>
              <span className="grid h-9 w-9 place-items-center rounded-lg"
                    style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                <step.icon size={18} />
              </span>
              <h3 className="mt-3.5 font-semibold tracking-tight text-ink-primary">{step.title}</h3>
              <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink-secondary">
                {step.body}
              </p>
            </Card>
          ))}
        </div>
      </section>

      {/* ----------------------------------------------------- capabilities */}
      <section>
        <div className="mb-5 text-center">
          <h2 className="text-[1.5rem] font-bold tracking-tight text-ink-primary">
            What it detects
          </h2>
          <p className="mt-2 text-[0.9375rem] text-ink-secondary">
            A dedicated pipeline for each medium, each producing evidence you can examine.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {CAPABILITIES.map((item) => (
            <Card key={item.kind}>
              <div className="flex items-center gap-2.5">
                <span className="text-accent"><item.icon size={19} /></span>
                <h3 className="font-semibold tracking-tight text-ink-primary">{item.kind}</h3>
              </div>
              <p className="mt-3 text-[0.8125rem] leading-relaxed text-ink-secondary">
                {item.detail}
              </p>
              <p className="mt-3 border-t pt-3 text-[0.75rem] text-ink-muted"
                 style={{ borderColor: 'var(--border-subtle)' }}>
                <span className="font-medium text-ink-secondary">Evidence:</span> {item.evidence}
              </p>
            </Card>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------- assurances */}
      <section className="grid gap-4 sm:grid-cols-3">
        {ASSURANCES.map((item) => (
          <div key={item.title} className="flex gap-3">
            <span className="mt-0.5 shrink-0 text-ink-muted"><item.icon size={17} /></span>
            <div>
              <p className="text-[0.875rem] font-semibold text-ink-primary">{item.title}</p>
              <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-secondary">
                {item.body}
              </p>
            </div>
          </div>
        ))}
      </section>

      <Notice tone="warn" title="Read this before relying on a result">
        Deepfake detectors are not certain. Authentic media is sometimes flagged, and skilled
        manipulations are sometimes missed. This tool provides an automated technical assessment;
        for legal proceedings, verification by a certified forensic expert is recommended.
      </Notice>
    </div>
  )
}
