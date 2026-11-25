import { useEffect, useState } from "react";
import { BookContextMenu } from "../../../src/features/library/BookContextMenu";
import { ContextMenuSurface, ContextMenuTrigger } from "../../../src/components/ContextMenu";
import {
  openContextMenuFromKeyboard,
  openContextMenuFromPointer,
  useContextMenuController,
} from "../../../src/components/contextMenuController";
import { Dialog } from "../../../src/components/Dialog";
import { TooltipProvider } from "../../../src/components/Tooltip";

export function ActionMenuFixture() {
  const controller = useContextMenuController();
  const dialogController = useContextMenuController();
  const [dialog, setDialog] = useState(false);
  const [selection, setSelection] = useState("");
  const params = new URLSearchParams(location.search);
  const bookMode = params.has("book");
  const edge = params.has("edge");
  const [extraAction, setExtraAction] = useState(false);
  useEffect(() => {
    const addAction = () => setExtraAction(true);
    window.addEventListener("fixture-add-menu-action", addAction);
    return () => window.removeEventListener("fixture-add-menu-action", addAction);
  }, []);
  const noop = () => undefined;
  return (
    <TooltipProvider>
      <main style={{ position: "fixed", inset: 12 }}>
        <button
          type="button"
          style={{
            position: "absolute",
            ...(edge ? { right: 0, bottom: 50 } : { left: 0, top: 0 }),
          }}
          onContextMenu={(event) =>
            openContextMenuFromPointer(controller, event, event.currentTarget)
          }
          onKeyDown={(event) => openContextMenuFromKeyboard(controller, event)}
        >
          Resource
        </button>
        <button
          type="button"
          style={{ position: "absolute", top: 45, right: 0 }}
          onClick={() => setSelection("Outside")}
        >
          Outside
        </button>
        <output>{selection}</output>
        <div style={{ position: "absolute", right: 0, bottom: 0, width: 40, height: 40 }}>
          {bookMode ? (
            <BookContextMenu
              book={{
                id: "book",
                fileName: "book.epub",
                originalTitle: "Book",
                addedAt: "1",
                updatedAt: "1",
                isFavorite: false,
              }}
              controller={controller}
              placement="row"
              canManageFile
              onRead={noop}
              onDelete={noop}
              onEditMetadata={() => setDialog(true)}
              onMove={noop}
              onRenameFile={noop}
              onRevealFile={noop}
              onToggleFavorite={noop}
              onToggleManualCompletion={noop}
            />
          ) : (
            <ContextMenuTrigger controller={controller} label="Actions">
              •••
            </ContextMenuTrigger>
          )}
        </div>
        {!bookMode && (
          <ContextMenuSurface
            controller={controller}
            ariaLabel="Resource actions"
            actions={[
              { id: "disabled", label: "Unavailable", disabled: true, onSelect: noop },
              {
                id: "explained",
                label: "Read",
                disabled: true,
                disabledReason: "File missing",
                onSelect: noop,
              },
              { id: "edit", label: "Edit metadata", onSelect: () => setDialog(true) },
              ...(extraAction
                ? [{ id: "extra", label: "Additional file action", onSelect: noop }]
                : []),
              {
                id: "delete",
                label: "Delete EPUB",
                danger: true,
                onSelect: () => setSelection("Deleted"),
              },
            ]}
          />
        )}
        {dialog && (
          <Dialog
            title="Edit metadata"
            onClose={() => setDialog(false)}
            footer={
              <button type="button" onClick={() => setDialog(false)}>
                Cancel
              </button>
            }
          >
            Edit form
            <ContextMenuTrigger controller={dialogController} label="Dialog actions">
              •••
            </ContextMenuTrigger>
            <ContextMenuSurface
              controller={dialogController}
              ariaLabel="Dialog actions"
              actions={[{ id: "done", label: "Finish editing", onSelect: () => setDialog(false) }]}
            />
          </Dialog>
        )}
      </main>
    </TooltipProvider>
  );
}
