import { forwardRef } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  icon?: ReactNode;
  label: string;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className = "", icon, label, id, ...props },
  ref,
) {
  const inputId = id ?? `input-${label.toLowerCase().replaceAll(" ", "-")}`;

  return (
    <label className={`input-shell ${className}`.trim()} htmlFor={inputId}>
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
