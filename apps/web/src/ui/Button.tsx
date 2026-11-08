import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "ok" | "danger" | "ghost";

const styles: Record<Variant, string> = {
  primary: "bg-gradient-to-r from-accent to-accent-2 text-black hover:brightness-110",
  ok: "bg-ok text-white hover:brightness-110",
  danger: "bg-danger text-white hover:brightness-110",
  ghost: "border border-line bg-panel-2 text-white hover:border-accent/60",
};

export function Button({ variant = "ghost", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${styles[variant]} ${className}`}
    />
  );
}
