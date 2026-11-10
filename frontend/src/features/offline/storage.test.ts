import { set } from "idb-keyval";

vi.mock("idb-keyval", () => ({
  createStore: vi.fn(() => "store"),
  get: vi.fn(() => Promise.resolve("compte")),
  set: vi.fn(() => Promise.resolve()),
  del: vi.fn(() => Promise.resolve()),
  clear: vi.fn(() => Promise.resolve()),
}));

/**
 * Verrous web comme Chromium : `steal` rend le verrou au dernier demandeur et fait échouer la
 * demande précédente (`AbortError`).
 */
function fakeLocks() {
  let abortHolder: ((reason: Error) => void) | undefined;
  const request = vi.fn(
    (_name: string, _options: LockOptions, callback: () => Promise<never>): Promise<never> => {
      abortHolder?.(new DOMException("Verrou volé", "AbortError"));
      return new Promise<never>((_resolve, reject) => {
        abortHolder = reject;
        void callback();
      });
    },
  );
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request } });
  return request;
}

const client = { buster: "", timestamp: 0, clientState: { queries: [], mutations: [] } };

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("indexedDB", {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "locks");
  vi.mocked(set).mockClear();
});

describe("createOfflinePersister", () => {
  it("ne demande le verrou qu'une fois par page, même si React recrée le persister", async () => {
    const request = fakeLocks();
    const { createOfflinePersister } = await import("./storage");
    const lost = vi.fn();

    // Rendu abandonné puis repris : l'initialiseur d'état est rappelé.
    createOfflinePersister(lost);
    const persister = createOfflinePersister(lost);
    await persister.persistClient(client);

    expect(request).toHaveBeenCalledOnce();
    expect(lost).not.toHaveBeenCalled();
    // La page tient le verrou : la copie est bien écrite.
    expect(set).toHaveBeenCalledOnce();
  });
});
