import { useState, useCallback, useRef, useEffect } from "react";
import {
  capturePhoto,
  pickPhoto,
  isCameraEnabled,
  type CameraOutcome,
  type CameraError,
} from "@/lib/camera";

type CameraState = {
  dataUrl: string | null;
  error: CameraError | null;
  loading: boolean;
};

type UseCameraCaptureOptions = {
  quality?: number;
};

type UseCameraCaptureReturn = CameraState & {
  enabled: boolean;
  capture: () => Promise<void>;
  pick: () => Promise<void>;
  clear: () => void;
};

const CAMERA_ENABLED = isCameraEnabled();

/**
 * Hook for camera capture and photo picking.
 * Only active when VITE_FEATURE_CAMERA=true; `enabled` is false otherwise.
 */
export function useCameraCapture(options?: UseCameraCaptureOptions): UseCameraCaptureReturn {
  const quality = options?.quality ?? 80;
  const [state, setState] = useState<CameraState>({
    dataUrl: null,
    error: null,
    loading: false,
  });
  const loadingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleOutcome = useCallback((outcome: CameraOutcome) => {
    if (!mountedRef.current) return;
    loadingRef.current = false;
    if (outcome.ok) {
      setState({ dataUrl: outcome.result.dataUrl, error: null, loading: false });
    } else {
      setState({ dataUrl: null, error: outcome.error, loading: false });
    }
  }, []);

  const capture = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    if (mountedRef.current) {
      setState((s) => ({ ...s, loading: true, error: null }));
    }
    const outcome = await capturePhoto({ quality });
    handleOutcome(outcome);
  }, [handleOutcome, quality]);

  const pick = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    if (mountedRef.current) {
      setState((s) => ({ ...s, loading: true, error: null }));
    }
    const outcome = await pickPhoto({ quality });
    handleOutcome(outcome);
  }, [handleOutcome, quality]);

  const clear = useCallback(() => {
    loadingRef.current = false;
    setState({ dataUrl: null, error: null, loading: false });
  }, []);

  return {
    ...state,
    enabled: CAMERA_ENABLED,
    capture,
    pick,
    clear,
  };
}
