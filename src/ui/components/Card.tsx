import React from "react";
export const Card: React.FC<{children?: React.ReactNode}> = ({ children }) => (<div className="card">{children}</div>);