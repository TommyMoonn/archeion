type DialogLoadingFallbackProps = {
  label: string;
};

export function DialogLoadingFallback({ label }: DialogLoadingFallbackProps) {
  return (
    <div aria-live="polite" className="dialog-loading-fallback" role="status">
      <div className="dialog-loading-fallback__panel">
        <span aria-hidden="true" className="dialog-loading-fallback__indicator" />
        <span>{label}</span>
      </div>
    </div>
  );
}
