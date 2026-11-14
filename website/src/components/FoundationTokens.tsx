// Temporary compiled-utility fixture; B1.5 owns its removal after workflow validation.
export default function FoundationTokens() {
  return (
    <section
      aria-label="Design token sample"
      className="max-w-site px-gutter-mobile py-4 font-sans navigation:px-gutter"
    >
      <div className="relative z-header grid gap-3 rounded-card border border-solid border-border bg-surface p-4 text-body text-content">
        <p className="m-0 font-editorial text-lead text-content-strong">Shared foundations</p>
        <p className="m-0 text-caption text-content-muted">Semantic website roles</p>
        <div className="rounded-control bg-surface-raised p-3 text-content">Raised surface</div>
        <div className="rounded-control bg-surface-sunken p-3 text-content">Sunken surface</div>
        <div className="rounded-control bg-surface-overlay p-3 text-content">Overlay surface</div>
        <div className="rounded-control bg-accent-subtle p-3 text-content">Selected surface</div>
        <div className="flex flex-wrap gap-3 text-caption">
          <span className="text-success">Success</span>
          <span className="text-warning">Warning</span>
          <span className="text-danger">Danger</span>
          <span className="text-info">Information</span>
        </div>
      </div>
    </section>
  );
}
