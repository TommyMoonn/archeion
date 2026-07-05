import { Plus } from "@phosphor-icons/react";
import { useRef, type ChangeEvent } from "react";

import { Button } from "../../components/Button";

type ImportButtonProps = {
  disabled?: boolean;
  onFiles: (files: File[]) => void;
};

export function ImportButton({ disabled = false, onFiles }: ImportButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);

    event.currentTarget.value = "";

    if (files.length > 0) {
      onFiles(files);
    }
  }

  return (
    <>
      <Button
        disabled={disabled}
        icon={<Plus aria-hidden="true" size={17} weight="bold" />}
        onClick={() => inputRef.current?.click()}
      >
        {disabled ? "Adding" : "Add books"}
      </Button>
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        accept=".epub,application/epub+zip"
        multiple
        onChange={handleChange}
        tabIndex={-1}
      />
    </>
  );
}
