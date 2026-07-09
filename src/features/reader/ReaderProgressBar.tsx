type ReaderProgressBarProps = {
  percentage: number;
  placement: "top" | "side";
};

export function ReaderProgressBar({ percentage, placement }: ReaderProgressBarProps) {
  return (
    <div
      className="reader-progress"
      data-placement={placement}
      role="progressbar"
      aria-label="Reading progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percentage)}
    >
      <span
        style={placement === "side" ? { height: `${percentage}%` } : { width: `${percentage}%` }}
      />
    </div>
  );
}
