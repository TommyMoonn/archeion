import { useLayoutEffect, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { Dialog } from "../../../src/components/Dialog";
import { SurfacePresence } from "../../../src/components/SurfacePresence";
import { TooltipProvider } from "../../../src/components/Tooltip";
import { BookDetailsDrawerFrame } from "../../../src/features/library/BookDetailsDrawerFrame";
import { QuickActionsPalette } from "../../../src/features/quick-actions/QuickActionsPalette";
import { QuickActionsRegistry } from "../../../src/features/quick-actions/quickActions";
import "../../../src/styles/index.css";

const registry = new QuickActionsRegistry();
registry.register("fixture", [
  {
    configuration: "unbound",
    id: "run",
    label: "Run command",
    group: "General",
    scope: "global",
    execute: () => {},
  },
]);
const book = {
  id: "book",
  fileName: "Example.epub",
  originalTitle: "Example",
  isFavorite: false,
  addedAt: "2026-10-27",
  updatedAt: "2026-10-27",
};
const noop = () => {};
const params = new URLSearchParams(location.search);
const kind = params.get("surface") ?? "dialog";
const baseline = params.has("baseline");
document.documentElement.dataset.motion = params.get("motion") ?? "on";

declare global {
  interface Window {
    modalLifetime: {
      show: (identity?: string) => void;
      close: () => void;
      teardown: () => void;
      submits: number;
      dismissals: number;
    };
  }
}

export function Fixture() {
  const [identity, setIdentity] = useState<string | null>(null);
  const [alive, setAlive] = useState(true);
  const [nested, setNested] = useState(false);
  const close = () => {
    window.modalLifetime.dismissals += 1;
    setIdentity(null);
  };
  const submit = () => {
    window.modalLifetime.submits += 1;
  };
  useLayoutEffect(() => {
    window.modalLifetime = {
      ...window.modalLifetime,
      show: (id = "first") => flushSync(() => setIdentity(id)),
      close: () => flushSync(close),
      teardown: () => setAlive(false),
      submits: window.modalLifetime?.submits ?? 0,
      dismissals: window.modalLifetime?.dismissals ?? 0,
    };
  });

  const child = identity ? (
    kind === "drawer" ? (
      <BookDetailsDrawerFrame
        key={identity}
        book={book}
        onClose={close}
        onClearProgress={noop}
        onDelete={noop}
        onRead={noop}
        onReadFromBeginning={noop}
        onReplaceCover={noop}
        onMoveFile={noop}
        onRenameFile={noop}
        onRevealFile={noop}
        onRescan={noop}
        onViewMetadata={noop}
        onToggleFavorite={noop}
      >
        <button onClick={submit}>Delete</button>
      </BookDetailsDrawerFrame>
    ) : kind === "palette" ? (
      <QuickActionsPalette
        key={identity}
        keyboard={{ shortcuts: {} }}
        registry={registry}
        onClose={close}
        onExecute={() => {
          submit();
          setIdentity(null);
          return { kind: "close" };
        }}
      />
    ) : (
      <Dialog
        key={identity}
        title={identity}
        onClose={close}
        footer={
          <>
            <button onClick={close}>Cancel</button>
            <button onClick={submit}>Delete</button>
          </>
        }
      >
        <button>Inside</button>
        <button onClick={() => setNested(true)}>Open nested</button>
        <SurfacePresence>
          {nested ? (
            <Dialog title="Nested" onClose={() => setNested(false)}>
              Nested content
            </Dialog>
          ) : null}
        </SurfacePresence>
      </Dialog>
    )
  ) : null;
  return (
    <>
      <button onClick={() => setIdentity("first")}>Open surface</button>
      <button onClick={submit}>Background action</button>
      <section className="library">
        <header className="library-header">
          <h1>Library</h1>
        </header>
        <div className="book-grid">
          <article className="book-card">Example</article>
        </div>
      </section>
      {alive ? baseline ? child : <SurfacePresence>{child}</SurfacePresence> : null}
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <TooltipProvider>
    <Fixture />
  </TooltipProvider>,
);
