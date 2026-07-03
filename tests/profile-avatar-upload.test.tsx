/**
 * @vitest-environment happy-dom
 *
 * Regression: after a SUCCESSFUL avatar upload the profile hero must render the
 * server's presigned URL — never the local object URL, which is revoked in the
 * `finally` block. Before the fix, `previewUrl` was only cleared on error, so
 * the <img> stayed pinned to a revoked blob: URL (broken on any re-decode).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const OBJECT_URL = "blob:preview-local";
const SERVER_URL = "https://cdn.example/avatars/u1-new.png";

const meMock = vi.fn();
const uploadAvatarMock = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ name: "Dana Vet", role: "admin", userId: "u1" }),
}));
vi.mock("@/lib/api", () => ({
  api: {
    users: {
      me: () => meMock(),
      uploadAvatar: (...a: unknown[]) => uploadAvatarMock(...a),
      updateDisplayName: vi.fn(),
    },
  },
}));

import { ProfileHeroZone } from "@/features/profile/ProfileHeroZone";

function renderHero() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Seed the profile query in a settled (fresh) state so the component does not
  // fetch on mount. `invalidateQueries` after upload then issues a *genuine*
  // refetch served by `meMock` — avoiding a race where invalidation coalesces
  // with a still-pending mount fetch.
  qc.setQueryData(["/api/users/me"], { avatarUrl: null });
  return render(
    <QueryClientProvider client={qc}>
      <ProfileHeroZone />
    </QueryClientProvider>,
  );
}

function fileInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('input[type="file"]');
  if (!input) throw new Error("file input not found");
  return input as HTMLInputElement;
}

describe("ProfileHeroZone — avatar upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The post-upload refetch returns the new presigned URL; upload itself just
    // resolves. (The seeded cache — see renderHero — holds the pre-upload null.)
    meMock.mockResolvedValue({ avatarUrl: SERVER_URL });
    uploadAvatarMock.mockResolvedValue(undefined);
    URL.createObjectURL = vi.fn(() => OBJECT_URL);
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => cleanup());

  it("renders the server URL (not the revoked object URL) after a successful upload", async () => {
    const { container } = renderHero();
    const file = new File(["x"], "photo.png", { type: "image/png" });

    fireEvent.change(fileInput(container), { target: { files: [file] } });

    await waitFor(() => expect(uploadAvatarMock).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      const img = screen.getByRole("img") as HTMLImageElement;
      expect(img.getAttribute("src")).toBe(SERVER_URL);
    });
    // The transient preview was revoked, and it is NOT what we ended up showing.
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(OBJECT_URL);
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("rejects a non-image file without calling upload", async () => {
    const { container } = renderHero();
    const file = new File(["x"], "notes.txt", { type: "text/plain" });

    fireEvent.change(fileInput(container), { target: { files: [file] } });

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(uploadAvatarMock).not.toHaveBeenCalled();
  });

  it("clears the preview and surfaces an error toast when the upload fails", async () => {
    uploadAvatarMock.mockRejectedValueOnce(new Error("network down"));
    const { container } = renderHero();
    const file = new File(["x"], "photo.png", { type: "image/png" });

    fireEvent.change(fileInput(container), { target: { files: [file] } });

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalled();
    // Preview reset → falls back to initials, no broken <img>.
    expect(screen.queryByRole("img")).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(OBJECT_URL);
  });
});
