import { renderHook, waitFor } from "@testing-library/react";

import { useWakeLock } from "./use-wake-lock";

function stubWakeLock() {
  const release = vi.fn(() => Promise.resolve());
  const request = vi.fn(() => Promise.resolve({ released: false, release }));
  Object.defineProperty(navigator, "wakeLock", { value: { request }, configurable: true });
  return { request, release };
}

describe("useWakeLock", () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, "wakeLock");
  });

  it("garde l'écran allumé puis le relâche en quittant la séance", async () => {
    const { request, release } = stubWakeLock();
    const { unmount } = renderHook(() => {
      useWakeLock(true);
    });

    await waitFor(() => {
      expect(request).toHaveBeenCalledWith("screen");
    });
    unmount();

    await waitFor(() => {
      expect(release).toHaveBeenCalledOnce();
    });
  });

  it("ne demande rien hors séance ni sans prise en charge", () => {
    const { request } = stubWakeLock();
    renderHook(() => {
      useWakeLock(false);
    });
    expect(request).not.toHaveBeenCalled();

    Reflect.deleteProperty(navigator, "wakeLock");
    expect(() =>
      renderHook(() => {
        useWakeLock(true);
      }),
    ).not.toThrow();
  });
});
