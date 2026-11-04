import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { BarcodeScanner, CAMERA_REFUSED } from "./barcode-scanner";

const stopTrack = vi.fn();

function camera({ refused = false } = {}) {
  const getUserMedia = vi.fn(() =>
    refused
      ? Promise.reject(new Error("NotAllowedError"))
      : Promise.resolve({ getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream),
  );
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  return getUserMedia;
}

function detector(results: { rawValue: string }[][]) {
  const formats: string[][] = [];
  class FakeDetector {
    constructor(options: { formats: string[] }) {
      formats.push(options.formats);
    }

    detect() {
      return Promise.resolve(results.shift() ?? []);
    }
  }
  vi.stubGlobal("BarcodeDetector", FakeDetector);
  return formats;
}

beforeEach(() => {
  stopTrack.mockReset();
  // jsdom ne lit pas de vidéo.
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "mediaDevices");
});

describe("BarcodeScanner", () => {
  it("ne s'affiche pas si le navigateur ne sait pas lire de code-barres", () => {
    camera();
    const { container } = render(<BarcodeScanner onDetected={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("lit un code de produit avec la caméra arrière, puis coupe la caméra", async () => {
    const getUserMedia = camera();
    const formats = detector([
      [],
      [{ rawValue: "https://pas-un-code" }],
      [{ rawValue: "3017624010701" }],
    ]);
    const onDetected = vi.fn();
    const user = userEvent.setup();
    render(<BarcodeScanner onDetected={onDetected} />);

    await user.click(screen.getByRole("button", { name: "Scanner avec l’appareil photo" }));
    expect(screen.getByLabelText("Image de la caméra : visez le code-barres")).toBeVisible();

    await waitFor(
      () => {
        expect(onDetected).toHaveBeenCalledWith("3017624010701");
      },
      { timeout: 3000 },
    );
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: "environment" },
      audio: false,
    });
    expect(formats[0]).toEqual(["ean_13", "ean_8", "upc_a", "upc_e"]);
    expect(stopTrack).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Scanner avec l’appareil photo" })).toBeVisible();
  });

  it("explique un refus de la caméra", async () => {
    camera({ refused: true });
    detector([]);
    const user = userEvent.setup();
    render(<BarcodeScanner onDetected={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Scanner avec l’appareil photo" }));

    expect(await screen.findByText(CAMERA_REFUSED)).toBeVisible();
  });

  it("coupe la caméra quand on arrête", async () => {
    camera();
    detector([]);
    const user = userEvent.setup();
    render(<BarcodeScanner onDetected={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Scanner avec l’appareil photo" }));
    await user.click(await screen.findByRole("button", { name: "Arrêter le scan" }));

    await waitFor(() => {
      expect(stopTrack).toHaveBeenCalled();
    });
  });
});
