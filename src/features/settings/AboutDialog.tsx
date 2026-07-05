import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { BookOpenText, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

import { IconButton } from "../../components/IconButton";

type AboutDialogProps = {
  onClose: () => void;
};

export function AboutDialog({ onClose }: AboutDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [version, setVersion] = useState("0.1.0");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
    if (isTauri()) {
      void getVersion().then(setVersion).catch(() => undefined);
    }

    return () => {
      if (dialog?.open) {
        dialog.close();
      }
    };
  }, []);

  return (
    <dialog
      aria-labelledby="about-title"
      className="about-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      ref={dialogRef}
    >
      <section className="about-window">
        <IconButton
          autoFocus
          className="about-window__close"
          label="Close About"
          onClick={onClose}
        >
          <X aria-hidden="true" size={17} />
        </IconButton>
        <BookOpenText aria-hidden="true" size={34} weight="thin" />
        <div>
          <p>Local EPUB archive</p>
          <h1 id="about-title">Archeion</h1>
          <span>Version {version}</span>
        </div>
        <p>Your library and reading data stay on this device.</p>
      </section>
    </dialog>
  );
}
