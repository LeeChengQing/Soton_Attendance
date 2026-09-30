export interface PhoneEntitlement {
  status?: unknown;
  phone_notifications?: unknown;
  starts_at?: unknown;
  expires_at?: unknown;
}

export function hasActivePhoneEntitlement(entitlement: unknown, nowMs: number): boolean {
  if (!Number.isFinite(nowMs) || !entitlement || typeof entitlement !== "object") return false;
  const value = entitlement as PhoneEntitlement;
  if (value.status !== "active" || value.phone_notifications !== true) return false;
  if (typeof value.starts_at !== "string" || typeof value.expires_at !== "string") return false;

  const startsAt = Date.parse(value.starts_at);
  const expiresAt = Date.parse(value.expires_at);
  return Number.isFinite(startsAt) && Number.isFinite(expiresAt) && startsAt <= nowMs && expiresAt > nowMs;
}

export async function gatePhoneNotification(
  entitlement: unknown,
  nowMs: number,
  onDenied: () => void | Promise<void>,
): Promise<boolean> {
  if (hasActivePhoneEntitlement(entitlement, nowMs)) return true;
  await onDenied();
  return false;
}
