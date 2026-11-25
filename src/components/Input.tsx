import { forwardRef, useId } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import type { ControlSize } from "./Button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./ui/input-group";

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  icon?: ReactNode;
  label: string;
  size?: Exclude<ControlSize, "compact">;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className = "", icon, label, id, size = "prominent", ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? `input-${generatedId}`;
  const externallyLabelled = Boolean(props["aria-labelledby"]);

  return (
    <InputGroup
      className={`input-shell input-shell--${size} ${size === "standard" ? "min-h-control-standard" : "min-h-control-prominent"} ${className}`.trim()}
      htmlFor={inputId}
    >
      {externallyLabelled ? null : <span className="sr-only">{label}</span>}
      {icon ? (
        <InputGroupAddon aria-hidden="true" className="input-shell__icon icon-slot">
          {icon}
        </InputGroupAddon>
      ) : null}
      <InputGroupInput id={inputId} ref={ref} {...props} />
    </InputGroup>
  );
});
