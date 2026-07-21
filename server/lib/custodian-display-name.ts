/** Staff-facing custodian label for the kiosk — clinic display name first, then
 *  user name; never a full email address (last resort is the email local part). */
export function resolveCustodianDisplayName(
  displayName: string | null | undefined,
  name: string | null | undefined,
  email: string | null | undefined,
): string | undefined {
  const named = displayName?.trim() || name?.trim();
  if (named) return named;
  const localPart = email?.split("@")[0]?.trim();
  return localPart || undefined;
}
