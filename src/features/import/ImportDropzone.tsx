import {
  useState,
  type DragEvent,
  type ReactNode,
} from "react";

type ImportDropzoneProps = {
  children: ReactNode;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
};

function hasFiles(event: DragEvent<HTMLDivElement>): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

export function ImportDropzone({
  children,
  disabled = false,
  onFiles,
}: ImportDropzoneProps) {
  const [dragDepth, setDragDepth] = useState(0);
  const isDragging = dragDepth > 0;

  function handleDragEnter(event: DragEvent<HTMLDivElement>) {
    if (disabled || !hasFiles(event)) {
      return;
    }

    event.preventDefault();
    setDragDepth((currentDepth) => currentDepth + 1);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    if (disabled || !hasFiles(event)) {
      return;
    }

    event.preventDefault();
    setDragDepth((currentDepth) => Math.max(0, currentDepth - 1));
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (disabled || !hasFiles(event)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (disabled || !hasFiles(event)) {
      return;
    }

    event.preventDefault();
    setDragDepth(0);

    const files = Array.from(event.dataTransfer.files);

    if (files.length > 0) {
      onFiles(files);
    }
  }

  return (
    <div
      className="import-dropzone"
      data-dragging={isDragging || undefined}
      aria-busy={disabled}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {children}
      {isDragging ? (
        <div className="drop-overlay" aria-hidden="true">
          <span>Drop EPUB files to add</span>
        </div>
      ) : null}
    </div>
  );
}
