import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { REST_OVER, RestTimer } from "./rest-timer";
import { DEFAULT_REST_SECONDS, MIN_REST_SECONDS, useRestTimer } from "./use-rest-timer";

describe("useRestTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(navigator, "vibrate");
  });

  it("décompte depuis l'heure de fin, vibre et signale la fin", () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
    const { result } = renderHook(() => useRestTimer());

    act(() => {
      result.current.start();
    });
    expect(result.current.remaining).toBe(DEFAULT_REST_SECONDS);
    // Onglet en veille : aucun intervalle exécuté pendant 90 s, le temps reste juste au retour.
    act(() => {
      vi.setSystemTime(Date.now() + 90_000);
      vi.advanceTimersByTime(250);
    });
    expect(result.current.remaining).toBe(30);

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(result.current.remaining).toBeNull();
    expect(result.current.finished).toBe(true);
    expect(vibrate).toHaveBeenCalledOnce();
  });

  it("ajuste le repos en cours et les suivants, sans descendre sous le minimum", () => {
    const { result } = renderHook(() => useRestTimer());

    act(() => {
      result.current.start();
      result.current.adjust(30);
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(result.current.remaining).toBe(150);
    expect(result.current.duration).toBe(150);

    act(() => {
      result.current.adjust(-1000);
    });
    expect(result.current.duration).toBe(MIN_REST_SECONDS);
  });

  it("s'arrête sans annoncer de fin", () => {
    const { result } = renderHook(() => useRestTimer());

    act(() => {
      result.current.start();
      result.current.stop();
    });

    expect(result.current.remaining).toBeNull();
    expect(result.current.finished).toBe(false);
  });
});

describe("RestTimer", () => {
  it("affiche le temps restant et des commandes nommées d'après leur texte", async () => {
    const adjust = vi.fn();
    const stop = vi.fn();
    const timer = { remaining: 95, duration: 120, finished: false, start: vi.fn(), adjust, stop };
    const user = userEvent.setup();
    render(<RestTimer timer={timer} />);

    expect(screen.getByRole("timer", { name: "Repos" })).toHaveTextContent("1:35");
    await user.click(screen.getByRole("button", { name: "+15 s de repos" }));
    await user.click(screen.getByRole("button", { name: "Passer" }));

    expect(adjust).toHaveBeenCalledWith(15);
    expect(stop).toHaveBeenCalledOnce();
  });

  it("annonce la fin du repos", () => {
    const timer = {
      remaining: null,
      duration: 120,
      finished: true,
      start: vi.fn(),
      adjust: vi.fn(),
      stop: vi.fn(),
    };
    render(<RestTimer timer={timer} />);

    expect(screen.getByRole("status")).toHaveTextContent(REST_OVER);
    expect(screen.queryByRole("timer")).toBeNull();
  });
});
