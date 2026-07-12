import { forwardRef } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import type { ControlSize } from "./Button";

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  icon?: ReactNode;
  label: string;
  size?: Exclude<ControlSize, "compact">;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className = "", icon, label, id, size = "prominent", ...props },
  ref,
) {
  const inputId = id ?? `input-${label.toLowerCase().replaceAll(" ", "-")}`;

  return (
    <label className={`input-shell input-shell--${size} ${className}`.trim()} htmlFor={inputId}>
      <span className="sr-only">{label}</span>
      {icon ? (
        <span aria-hidden="true" className="input-shell__icon icon-slot">
          {icon}
        </span>
      ) : null}
      <input id={inputId} ref={ref} {...props} />
    </label>
  );
});
