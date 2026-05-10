import React from "react";
type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger"; size?: "sm" | "md" | "lg"; };
export const Button: React.FC<ButtonProps> = ({ variant = "primary", size = "md", children, ...rest }) => {
  const base = "inline-flex items-center justify-center rounded-md font-medium transition";
  const sizes = { sm: "px-3 py-1.5 text-sm", md: "px-4 py-2 text-md", lg: "px-5 py-3 text-lg" };
  const variants = { primary: "bg-[var(--color-brand-primary)] text-white hover:bg-[var(--color-brand-500)]", ghost: "bg-transparent text-[var(--color-neutral-900)]", danger: "bg-[var(--color-danger)] text-white" };
  return (<button className={`${base} ${sizes[size]} ${variants[variant]}`} {...rest}>{children}</button>);
};
export default Button;