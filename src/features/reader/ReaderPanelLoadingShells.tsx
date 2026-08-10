import { ReaderSidePanel } from "./ReaderSidePanel";

type ReaderTocLoadingShellProps = {
  onClose: () => void;
};

export function ReaderTocLoadingShell({ onClose }: ReaderTocLoadingShellProps) {
  return (
    <ReaderSidePanel
      accessibleLabel="Table of contents"
      ariaBusy
      className="reader-toc"
      closeLabel="Close table of contents"
      eyebrow="Navigate"
      id="reader-table-of-contents"
      ignoreReaderShortcuts
      onClose={onClose}
      tabIndex={-1}
      title="Contents"
    >
      <div aria-label="Loading table of contents" className="reader-toc__loading" role="status">
        <span />
        <span />
        <span />
      </div>
    </ReaderSidePanel>
  );
}

type ReaderAnnotationsLoadingShellProps = {
  active?: boolean;
  onClose: () => void;
};

export function ReaderAnnotationsLoadingShell({
  active = true,
  onClose,
}: ReaderAnnotationsLoadingShellProps) {
  return (
    <ReaderSidePanel
      accessibleLabel="Annotations"
      ariaBusy
      className="reader-annotations"
      closeLabel={active ? "Close annotations" : undefined}
      eyebrow="Reading"
      hidden={!active}
      id={active ? "reader-annotations" : undefined}
      ignoreReaderShortcuts
      onClose={active ? onClose : undefined}
      tabIndex={active ? -1 : undefined}
      title="Annotations"
    >
      <div aria-label="Loading annotations" className="reader-toc__loading" role="status">
        <span />
        <span />
        <span />
      </div>
    </ReaderSidePanel>
  );
}

type ReaderSearchLoadingShellProps = {
  onClose: () => void;
};

export function ReaderSearchLoadingShell({ onClose }: ReaderSearchLoadingShellProps) {
  return (
    <ReaderSidePanel
      accessibleLabel="Find in book"
      ariaBusy
      className="reader-search"
      closeLabel="Close Find in Book"
      eyebrow="Search"
      id="reader-find-in-book"
      ignoreReaderShortcuts
      onClose={onClose}
      tabIndex={-1}
      title="Find in Book"
    >
      <div aria-label="Loading Find in Book" className="reader-toc__loading" role="status">
        <span />
        <span />
        <span />
      </div>
    </ReaderSidePanel>
  );
}
