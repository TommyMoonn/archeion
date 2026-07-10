import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { GithubLogo, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

import archeionIcon from "../../assets/brand/archeion-icon-128.png";
import { IconButton } from "../../components/IconButton";

const GITHUB_URL = "https://github.com/TommyMoonn/archeion";

type AboutDialogProps = {
  onClose: () => void;
};

export function AboutDialog({ onClose }: AboutDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [version, setVersion] = useState("0.2.0");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
    if (isTauri()) {
      void getVersion()
        .then(setVersion)
        .catch(() => undefined);
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
      aria-modal="true"
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
        <IconButton autoFocus className="about-window__close" label="Close About" onClick={onClose}>
          <X aria-hidden="true" size={17} />
        </IconButton>

        <div className="about-window__brand" aria-hidden="true">
          <img alt="" src={archeionIcon} />
        </div>

        <div className="about-window__copy">
          <h1 id="about-title">Archeion</h1>
          <p className="about-window__version">Version {version}</p>
        </div>

        <div className="about-window__github">
          <GithubLogo aria-hidden="true" size={20} weight="regular" />
          <div className="about-window__github-copy">
            <span>GitHub</span>
            <small>{GITHUB_URL}</small>
          </div>
          <a
            className="about-window__github-action"
            href={GITHUB_URL}
            rel="noreferrer"
            target="_blank"
          >
            Open
          </a>
        </div>
      </section>
    </dialog>
  );
}
