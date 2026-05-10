import React from "react";
export const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = (props) => {
  return (<input {...props} className="border rounded-md px-3 py-2 w-full focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-500)]" />);
};