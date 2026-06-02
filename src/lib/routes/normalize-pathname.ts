function stripTrailingSlashes(pathname: string): string {
  if (pathname === "/") return "/";
  return pathname.replace(/\/+$/, "") || "/";
}

/** Mandatory route-family pathname normalization (trailing slashes only). */
export function normalizePathname(input: string): string {
  let pathname: string;
  try {
    pathname = new URL(input, "http://local").pathname || "/";
  } catch {
    const withoutHash = input.split("#", 1)[0] ?? "";
    const withoutQuery = withoutHash.split("?", 1)[0] ?? "";
    const normalized = withoutQuery || "/";
    pathname = normalized.startsWith("/") ? normalized : `/${normalized}`;
  }
  return stripTrailingSlashes(pathname);
}
