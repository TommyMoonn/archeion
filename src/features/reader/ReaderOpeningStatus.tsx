export function ReaderOpeningStatus() {
  return (
    <div className="reader-loading">
      <span aria-hidden="true" className="reader-loading__line" />
      <span aria-hidden="true" className="reader-loading__line reader-loading__line--short" />
      <span role="status">Opening book</span>
    </div>
  );
}
