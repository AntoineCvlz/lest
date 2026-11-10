import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { notifyRestOver, REST_NOTIFICATION_TITLE } from "./rest-notification";
import { NOTIFY_DENIED, RestTimer } from "./rest-timer";
import type { RestTimer as Timer } from "./use-rest-timer";

const showNotification = vi.fn<(title: string, options?: NotificationOptions) => Promise<void>>();

/** Navigateur qui sait notifier ; la demande de permission donne `granted`. */
function browser(permission: NotificationPermission, granted: NotificationPermission = permission) {
  const notification = { permission, requestPermission: vi.fn() };
  notification.requestPermission.mockImplementation(() => {
    notification.permission = granted;
    return Promise.resolve(granted);
  });
  vi.stubGlobal("Notification", notification);
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { ready: Promise.resolve({ showNotification }) },
  });
  return notification.requestPermission;
}

function visibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
}

const resting: Timer = {
  remaining: 90,
  duration: 120,
  finished: false,
  start: vi.fn(),
  adjust: vi.fn(),
  stop: vi.fn(),
};

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "serviceWorker");
  visibility("visible");
  localStorage.clear();
  showNotification.mockReset();
});

describe("RestTimer : notification de fin de repos", () => {
  it("demande la permission au clic seulement, puis notifie l'app en arrière-plan", async () => {
    const requestPermission = browser("default", "granted");
    const user = userEvent.setup();
    render(<RestTimer timer={resting} />);
    expect(requestPermission).not.toHaveBeenCalled();

    const toggle = screen.getByRole("checkbox", { name: "Me prévenir à la fin du repos" });
    expect(toggle).toHaveAccessibleDescription(
      "Quand l’app est en arrière-plan, sur cet appareil.",
    );
    await user.click(toggle);

    expect(requestPermission).toHaveBeenCalledOnce();
    expect(toggle).toBeChecked();
    visibility("hidden");
    await notifyRestOver();
    // Texte fixe : aucune donnée de la séance dans la notification.
    expect(showNotification).toHaveBeenCalledWith(REST_NOTIFICATION_TITLE, {
      tag: "lest-rest",
      icon: "/icons/icon-192.png",
      lang: "fr",
    });
  });

  it("ne notifie pas quand l'app est à l'écran, ni quand ce n'est pas activé", async () => {
    browser("granted");
    visibility("hidden");
    await notifyRestOver();
    expect(showNotification).not.toHaveBeenCalled();

    localStorage.setItem("lest-rest-notification", "on");
    visibility("visible");
    await notifyRestOver();
    expect(showNotification).not.toHaveBeenCalled();
  });

  it("se désactive d'un appui", async () => {
    browser("granted");
    localStorage.setItem("lest-rest-notification", "on");
    const user = userEvent.setup();
    render(<RestTimer timer={resting} />);

    const toggle = screen.getByRole("checkbox", { name: "Me prévenir à la fin du repos" });
    expect(toggle).toBeChecked();
    await user.click(toggle);

    expect(toggle).not.toBeChecked();
    visibility("hidden");
    await notifyRestOver();
    expect(showNotification).not.toHaveBeenCalled();
  });

  it("dit comment réautoriser les notifications refusées", () => {
    browser("denied");
    render(<RestTimer timer={resting} />);

    expect(screen.getByText(NOTIFY_DENIED)).toBeVisible();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("ne propose rien si le navigateur ne sait pas notifier", () => {
    render(<RestTimer timer={resting} />);

    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});
