interface AuthState {
  userId: string;
  email: string;
  name: string;
  bearerToken: string | null;
  clinicId?: string;
}

let authState: AuthState = {
  userId: "",
  email: "",
  name: "",
  bearerToken: null,
};

function isLikelyJwt(token: string): boolean {
  const parts = token.split(".");
  return parts.length === 3 && parts.every((part) => part.trim().length > 0);
}

export function setAuthState(state: AuthState) {
  const normalizedToken = typeof state.bearerToken === "string" ? state.bearerToken.trim() : "";
  authState = {
    ...state,
    bearerToken: normalizedToken && isLikelyJwt(normalizedToken) ? normalizedToken : null,
  };
}

export function getAuthHeaders(): Record<string, string> {
  if (authState.bearerToken && isLikelyJwt(authState.bearerToken)) {
    return { Authorization: `Bearer ${authState.bearerToken}` };
  }
  return {};
}

export function getCurrentUserId(): string {
  return authState.userId;
}

export function setCurrentClinicId(clinicId?: string): void {
  const normalized = typeof clinicId === "string" ? clinicId.trim() : "";
  authState = {
    ...authState,
    clinicId: normalized || undefined,
  };
}

export function getCurrentClinicId(): string {
  return authState.clinicId?.trim() ?? "";
}

export function getCurrentUserEmail(): string {
  return authState.email;
}

export function getCurrentUserName(): string {
  return authState.name;
}

export function getStoredBearerToken(): string | null {
  return authState.bearerToken;
}
