export function safetyCheck(action: string): boolean {
  if (action === "dangerous") return false;
  return true;
}