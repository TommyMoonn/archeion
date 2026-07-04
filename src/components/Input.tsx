import type { InputHTMLAttributes, ReactNode } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  icon?: ReactNode;
  label: string;
};

export function Input({
  className = "",
  icon,
  label,
  id,
  ...props
}: InputProps) {
  const inputId = id ?? `input-${label.toLowerCase().replaceAll(" ", "-")}`;

  return (
    <label className={`input-shell ${className}`.trim()} htmlFor={inputId}>
      <span className="sr-only">{label}</span>
      {icon}
      <input id={inputId} {...props} />
    </label>
  );
}
