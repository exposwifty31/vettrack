/**
 * @vitest-environment happy-dom
 *
 * CodeRabbit PR #83 finding (main.tsx ~196-225, now src/components/clerk-locale-bridge.tsx)
 * — ClerkProvider only reliably reads its `localization` prop at init, so
 * updating the prop alone on a live locale switch doesn't reliably
 * re-localize an already-mounted Clerk sign-in card. `ClerkLocaleBridge` must
 * give ClerkProvider a locale-keyed `key` so React unmounts + remounts it
 * (and picks up the new localization) whenever the app's locale changes via
 * the "vettrack:locale-changed" event.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { useEffect, useState } from "react";

const mountMock = vi.fn();
const unmountMock = vi.fn();
const localeRef = { current: "he" as string };

// Deliberately empty effect deps: this fires only on a REAL mount/unmount of
// this component instance, never on a mere re-render with an updated
// `localization` prop. `instanceId` is fixed for the lifetime of one mounted
// instance, so a second distinct id proves React tore down the old
// ClerkProvider and created a fresh one (the `key`-driven remount) rather
// than reusing the same instance with new props.
vi.mock("@clerk/clerk-react", () => ({
  ClerkProvider: ({
    children,
    localization,
  }: {
    children: React.ReactNode;
    localization: { locale: string };
  }) => {
    const [instanceId] = useState(() => Symbol("clerk-provider-instance"));
    useEffect(() => {
      mountMock(instanceId, localization);
      return () => unmountMock(instanceId);
    }, []);
    return <div data-testid="clerk-provider">{children}</div>;
  },
}));

vi.mock("@/lib/clerk-capacitor-config", () => ({
  clerkLocalizationForLocale: (locale: string) => ({ locale }),
}));

vi.mock("@/lib/i18n", () => ({
  getCurrentLocale: () => localeRef.current,
}));

import { ClerkLocaleBridge } from "@/components/clerk-locale-bridge";

function setAppLocale(locale: string) {
  localeRef.current = locale;
  act(() => {
    window.dispatchEvent(new Event("vettrack:locale-changed"));
  });
}

describe("ClerkLocaleBridge — remount on locale change", () => {
  beforeEach(() => {
    mountMock.mockClear();
    unmountMock.mockClear();
    localeRef.current = "he";
  });
  afterEach(() => cleanup());

  it("mounts ClerkProvider once at boot with the current locale's localization", () => {
    render(
      <ClerkLocaleBridge runtimeProps={{} as never}>
        <div>child</div>
      </ClerkLocaleBridge>,
    );
    expect(mountMock).toHaveBeenCalledTimes(1);
    expect(mountMock).toHaveBeenCalledWith(expect.anything(), { locale: "he" });
  });

  it("unmounts and remounts ClerkProvider (not just a prop update) when locale changes", () => {
    render(
      <ClerkLocaleBridge runtimeProps={{} as never}>
        <div>child</div>
      </ClerkLocaleBridge>,
    );
    expect(mountMock).toHaveBeenCalledTimes(1);
    expect(unmountMock).not.toHaveBeenCalled();
    const firstInstanceId = mountMock.mock.calls[0][0] as symbol;

    setAppLocale("en");

    // A real remount (React tears down the old ClerkProvider instance and
    // mounts a fresh one under the new `key`) — not merely a re-render that
    // reuses the same instance with an updated prop.
    expect(unmountMock).toHaveBeenCalledTimes(1);
    expect(unmountMock).toHaveBeenCalledWith(firstInstanceId);
    expect(mountMock).toHaveBeenCalledTimes(2);
    const secondInstanceId = mountMock.mock.calls[1][0] as symbol;
    expect(secondInstanceId).not.toBe(firstInstanceId);
    expect(mountMock).toHaveBeenLastCalledWith(secondInstanceId, { locale: "en" });
  });
});
