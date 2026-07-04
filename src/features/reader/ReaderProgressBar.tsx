type ReaderProgressBarProps = {
  percentage: number;
};

export function ReaderProgressBar({
  percentage,
}: ReaderProgressBarProps) {
  return (
    <div
      className="reader-progress"
      role="progressbar"
      aria-label="Reading progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percentage)}
    >
      <span style={{ width: `${percentage}%` }} />
    </div>
  );
}
