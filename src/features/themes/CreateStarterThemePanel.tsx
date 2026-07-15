import { useState, type FormEvent } from "react";

import { AppSelect } from "../../components/AppSelect";
import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import type { AppThemeBase, ReaderThemeBase } from "../../themes/themeTokenRegistry";
import type { ThemeManagerController } from "./useThemeManagerController";

type ReaderChoice = ReaderThemeBase | "none";

type CreateStarterThemePanelProps = Readonly<{
  controller: ThemeManagerController;
  onClose: () => void;
}>;

const appBaseOptions = [
  { label: "Dark", value: "dark" },
  { label: "Light", value: "light" },
] satisfies Array<{ label: string; value: AppThemeBase }>;

const readerBaseOptions = [
  { label: "No reader palette", value: "none" },
  { label: "Dark", value: "dark" },
  { label: "Light", value: "light" },
  { label: "Sepia", value: "sepia" },
] satisfies Array<{ label: string; value: ReaderChoice }>;

export function CreateStarterThemePanel({ controller, onClose }: CreateStarterThemePanelProps) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [appBase, setAppBase] = useState<AppThemeBase>("dark");
  const [readerBase, setReaderBase] = useState<ReaderChoice>("none");
  const busy = controller.busyAction !== null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = await controller.createStarter({
      appBase,
      id,
      name,
      ...(readerBase === "none" ? {} : { readerBase }),
    });
    if (result === "created") onClose();
  }

  return (
    <form className="theme-starter-panel" onSubmit={(event) => void submit(event)}>
      <header>
        <div>
          <p>New package</p>
          <h3>Create starter theme</h3>
        </div>
        <Button disabled={busy} onClick={onClose} size="standard" variant="ghost">
          Cancel
        </Button>
      </header>
      <div className="theme-starter-panel__fields">
        <div className="theme-starter-panel__field">
          <span>Theme ID</span>
          <Input
            autoFocus
            label="Theme ID"
            onChange={(event) => setId(event.currentTarget.value)}
            placeholder="moon-ink"
            required
            value={id}
          />
        </div>
        <div className="theme-starter-panel__field">
          <span>Display name</span>
          <Input
            label="Display name"
            onChange={(event) => setName(event.currentTarget.value)}
            placeholder="Moon Ink"
            required
            value={name}
          />
        </div>
        <AppSelect
          label="Application base"
          onChange={setAppBase}
          options={appBaseOptions}
          value={appBase}
        />
        <AppSelect
          label="Reader base"
          onChange={setReaderBase}
          options={readerBaseOptions}
          value={readerBase}
        />
      </div>
      <footer>
        <span>The generated theme includes the public schema URL and one canonical override.</span>
        <Button busy={controller.busyAction === "starter"} disabled={busy} type="submit">
          Create starter
        </Button>
      </footer>
    </form>
  );
}
