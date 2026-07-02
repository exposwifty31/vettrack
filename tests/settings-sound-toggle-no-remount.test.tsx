/**
 * @vitest-environment happy-dom
 *
 * BUG-015 regression: toggling a non-locale setting (e.g. Master Sound) must not
 * broadcast "vettrack:locale-changed". main.tsx keys <App> by that event, so
 * firing it on every settings update remounts the whole tree and jumps the page.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { SettingsProvider, useSettings, type Settings } from "@/hooks/use-settings";
import { SettingsToggle } from "@/components/settings-controls";

const LOCALE_CHANGED = "vettrack:locale-changed";

let update: ((patch: Partial<Settings>) => void) | null = null;

function Probe() {
  update = useSettings().update;
  return null;
}

describe("BUG-015 — settings update remount avoidance", () => {
  beforeEach(() => {
    localStorage.clear();
    update = null;
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("does not dispatch vettrack:locale-changed when only soundEnabled changes", () => {
    const spy = vi.fn();
    window.addEventListener(LOCALE_CHANGED, spy);
    try {
      render(
        <SettingsProvider>
          <Probe />
        </SettingsProvider>,
      );
      expect(update).toBeTypeOf("function");
      // Mount alone must not have broadcast a locale change.
      expect(spy).not.toHaveBeenCalled();

      act(() => update!({ soundEnabled: true }));
      act(() => update!({ soundEnabled: false }));
      act(() => update!({ darkMode: true }));

      expect(spy).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(LOCALE_CHANGED, spy);
    }
  });

  it("still dispatches vettrack:locale-changed when the locale actually changes", () => {
    const spy = vi.fn();
    window.addEventListener(LOCALE_CHANGED, spy);
    try {
      render(
        <SettingsProvider>
          <Probe />
        </SettingsProvider>,
      );
      // Default stored locale is Hebrew; switching to English is a real change.
      act(() => update!({ locale: "en" }));
      expect(spy).toHaveBeenCalled();
    } finally {
      window.removeEventListener(LOCALE_CHANGED, spy);
    }
  });
});

describe("BUG-015 — SettingsToggle button type", () => {
  it("renders an explicit type=button switch (never an implicit submit)", () => {
    const { getByRole } = render(
      <SettingsToggle
        icon={<span />}
        label="Master sound"
        checked={false}
        onCheckedChange={() => {}}
        data-testid="t"
      />,
    );
    const btn = getByRole("switch");
    expect(btn.getAttribute("type")).toBe("button");
  });
});
