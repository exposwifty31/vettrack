import { isCapacitorNative } from "@/lib/capacitor-runtime";

export type CameraResult = {
  dataUrl: string;
  format: "jpeg" | "png" | "webp" | "heif";
};

export type CameraError =
  | "unsupported"
  | "permission_denied"
  | "cancelled"
  | "capture_failed"
  | "invalid_type"
  | "too_large";

export type CameraOutcome =
  | { ok: true; result: CameraResult }
  | { ok: false; error: CameraError };

/**
 * Camera feature is gated by VITE_FEATURE_CAMERA=true.
 * Returns false in production until explicitly enabled.
 */
export function isCameraEnabled(): boolean {
  return import.meta.env.VITE_FEATURE_CAMERA === "true";
}

async function loadCameraPlugin() {
  const { Camera, CameraResultType, CameraSource } = await import(
    "@capacitor/camera"
  );
  return { Camera, CameraResultType, CameraSource };
}

/**
 * Capture a photo using Capacitor Camera (native) or the browser file input fallback.
 * Resolves with a data URL; rejects with a typed CameraError.
 */
export async function capturePhoto(options?: {
  quality?: number;
  allowEditing?: boolean;
}): Promise<CameraOutcome> {
  if (!isCameraEnabled()) {
    return { ok: false, error: "unsupported" };
  }

  const quality = options?.quality ?? 80;

  if (isCapacitorNative()) {
    return captureNative(quality, options?.allowEditing ?? false);
  }
  return captureBrowser();
}

async function captureNative(
  quality: number,
  allowEditing: boolean,
): Promise<CameraOutcome> {
  try {
    const { Camera, CameraResultType, CameraSource } = await loadCameraPlugin();
    const photo = await Camera.getPhoto({
      quality,
      allowEditing,
      resultType: CameraResultType.DataUrl,
      source: CameraSource.Camera,
    });

    if (!photo.dataUrl) {
      return { ok: false, error: "capture_failed" };
    }

    const format = photo.format as "jpeg" | "png" | "webp" | "heif";
    const validFormats = ["jpeg", "png", "webp", "heif"];
    return {
      ok: true,
      result: {
        dataUrl: photo.dataUrl,
        format: validFormats.includes(format) ? format : "jpeg",
      },
    };
  } catch (err: unknown) {
    // Check typed error properties first
    if (err && typeof err === "object") {
      const anyErr = err as any;
      if (anyErr.code === "USER_CANCELLED" || anyErr.name === "CancelError") {
        return { ok: false, error: "cancelled" };
      }
      if (anyErr.code === "PERMISSION_DENIED" || anyErr.name === "PermissionError") {
        return { ok: false, error: "permission_denied" };
      }
    }
    // Fallback to string matching
    const msg = err instanceof Error ? err.message.toLowerCase() : "";
    if (msg.includes("cancelled") || msg.includes("canceled") || msg.includes("user_cancelled")) {
      return { ok: false, error: "cancelled" };
    }
    if (msg.includes("permission") || msg.includes("denied")) {
      return { ok: false, error: "permission_denied" };
    }
    return { ok: false, error: "capture_failed" };
  }
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB

function captureBrowser(): Promise<CameraOutcome> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.capture = "environment";
    input.setAttribute("aria-label", "Choose an image to upload");
    input.name = "photo";
    input.tabIndex = 0;

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      input.remove();
      window.removeEventListener("focus", onWindowFocus);
    };

    const onWindowFocus = () => {
      // Window regained focus - user may have cancelled
    };
    window.addEventListener("focus", onWindowFocus, { once: true });

    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        cleanup();
        resolve({ ok: false, error: "cancelled" });
        return;
      }

      // Validate MIME type
      if (!file.type.startsWith("image/")) {
        cleanup();
        resolve({ ok: false, error: "invalid_type" });
        return;
      }

      // Validate file size
      if (file.size > MAX_IMAGE_BYTES) {
        cleanup();
        resolve({ ok: false, error: "too_large" });
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        cleanup();
        const dataUrl = reader.result as string;
        const format =
          file.type === "image/png" ? "png" :
          file.type === "image/webp" ? "webp" :
          file.type === "image/heif" ? "heif" :
          "jpeg";
        resolve({
          ok: true,
          result: { dataUrl, format },
        });
      };
      reader.onerror = () => {
        cleanup();
        resolve({ ok: false, error: "capture_failed" });
      };
      reader.onabort = () => {
        cleanup();
        resolve({ ok: false, error: "cancelled" });
      };
      reader.readAsDataURL(file);
    };

    input.oncancel = () => {
      cleanup();
      resolve({ ok: false, error: "cancelled" });
    };

    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Pick an existing photo from the library (Capacitor native) or file picker (browser).
 */
export async function pickPhoto(options?: {
  quality?: number;
}): Promise<CameraOutcome> {
  if (!isCameraEnabled()) {
    return { ok: false, error: "unsupported" };
  }

  const quality = options?.quality ?? 80;

  if (isCapacitorNative()) {
    return pickNative(quality);
  }
  return pickBrowser();
}

async function pickNative(quality: number): Promise<CameraOutcome> {
  try {
    const { Camera, CameraResultType, CameraSource } = await loadCameraPlugin();
    const photo = await Camera.getPhoto({
      quality,
      allowEditing: false,
      resultType: CameraResultType.DataUrl,
      source: CameraSource.Photos,
    });

    if (!photo.dataUrl) {
      return { ok: false, error: "capture_failed" };
    }

    const format = photo.format as "jpeg" | "png" | "webp" | "heif";
    const validFormats = ["jpeg", "png", "webp", "heif"];
    return {
      ok: true,
      result: {
        dataUrl: photo.dataUrl,
        format: validFormats.includes(format) ? format : "jpeg",
      },
    };
  } catch (err: unknown) {
    // Check typed error properties first
    if (err && typeof err === "object") {
      const anyErr = err as any;
      if (anyErr.code === "USER_CANCELLED" || anyErr.name === "CancelError") {
        return { ok: false, error: "cancelled" };
      }
      if (anyErr.code === "PERMISSION_DENIED" || anyErr.name === "PermissionError") {
        return { ok: false, error: "permission_denied" };
      }
    }
    // Fallback to string matching
    const msg = err instanceof Error ? err.message.toLowerCase() : "";
    if (msg.includes("cancelled") || msg.includes("canceled")) {
      return { ok: false, error: "cancelled" };
    }
    if (msg.includes("permission") || msg.includes("denied")) {
      return { ok: false, error: "permission_denied" };
    }
    return { ok: false, error: "capture_failed" };
  }
}

function pickBrowser(): Promise<CameraOutcome> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.setAttribute("aria-label", "Choose an image to upload");
    input.name = "photo";
    input.tabIndex = 0;

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      input.remove();
    };

    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        cleanup();
        resolve({ ok: false, error: "cancelled" });
        return;
      }

      // Validate MIME type
      if (!file.type.startsWith("image/")) {
        cleanup();
        resolve({ ok: false, error: "invalid_type" });
        return;
      }

      // Validate file size
      if (file.size > MAX_IMAGE_BYTES) {
        cleanup();
        resolve({ ok: false, error: "too_large" });
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        cleanup();
        const format =
          file.type === "image/png" ? "png" :
          file.type === "image/webp" ? "webp" :
          file.type === "image/heif" ? "heif" :
          "jpeg";
        resolve({
          ok: true,
          result: {
            dataUrl: reader.result as string,
            format,
          },
        });
      };
      reader.onerror = () => {
        cleanup();
        resolve({ ok: false, error: "capture_failed" });
      };
      reader.onabort = () => {
        cleanup();
        resolve({ ok: false, error: "cancelled" });
      };
      reader.readAsDataURL(file);
    };

    document.body.appendChild(input);
    input.click();
  });
}
