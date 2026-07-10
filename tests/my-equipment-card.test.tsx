/**
 * @vitest-environment happy-dom
 *
 * MyEquipmentCard error handling (CodeRabbit #76): a rejected GET /api/equipment/my
 * (retry:false) must render a retryable failure state, not a silent empty card.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { ComponentProps } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { t } from "@/lib/i18n";
import { MyEquipmentCard } from "@/features/today/surfaces/floor/MyEquipmentCard";

function renderCard(props: Partial<ComponentProps<typeof MyEquipmentCard>> = {}) {
  const { hook } = memoryLocation({ path: "/home" });
  return render(
    <Router hook={hook}>
      <MyEquipmentCard items={undefined} isLoading={false} {...props} />
    </Router>,
  );
}

afterEach(() => cleanup());

describe("MyEquipmentCard", () => {
  it("renders a retryable failure state when the query rejected (isError)", () => {
    const onRetry = vi.fn();
    renderCard({ isError: true, onRetry });
    expect(screen.getByText(t.equipmentList.errors.loadFailed)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: t.common.tryAgain }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state (not the error) when the query succeeded with no items", () => {
    renderCard({ items: [], isLoading: false });
    expect(screen.getByText(t.homeSurface.myEquipmentEmpty)).toBeTruthy();
    expect(screen.queryByText(t.equipmentList.errors.loadFailed)).toBeNull();
  });
});
