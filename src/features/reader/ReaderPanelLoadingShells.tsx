import { ReaderSidePanel } from "./ReaderSidePanel";

type ReaderNavigationLoadingShellProps = {
  onClose: () => void;
};

export function ReaderNavigationLoadingShell({ onClose }: ReaderNavigationLoadingShellProps) {
  return (
    <ReaderSidePanel
      accessibleLabel="Book navigation"
      ariaBusy
      className="reader-navigation"
      closeLabel="Close book navigation"
      eyebrow="Navigate"
      id="reader-publication-navigation"
      ignoreReaderShortcuts
      onClose={onClose}
      tabIndex={-1}
      title="Navigation"
    >
      <div aria-label="Loading book navigation" className="reader-panel-loading" role="status">
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
      <div aria-label="Loading annotations" className="reader-panel-loading" role="status">
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
      <div aria-label="Loading Find in Book" className="reader-panel-loading" role="status">
        <span />
        <span />
        <span />
      </div>
    </ReaderSidePanel>
  );
}
