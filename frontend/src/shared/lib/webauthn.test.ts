import {
  createPasskey,
  getPasskey,
  PASSKEY_ALREADY_ADDED,
  PASSKEY_CANCELLED,
  PASSKEY_FAILED,
  toBase64Url,
} from "./webauthn";

// jsdom n'a pas WebAuthn : classes minimales, pour que les contrôles `instanceof` s'appliquent.
class FakeAttestation {
  clientDataJSON = bytes(1, 2);
  attestationObject = bytes(3, 4);
  getTransports() {
    return ["internal"];
  }
}
class FakeAssertion {
  clientDataJSON = bytes(1);
  authenticatorData = bytes(5);
  signature = bytes(6, 7);
  constructor(public userHandle: ArrayBuffer | null) {}
}
class FakeCredential {
  id = "AQI";
  rawId = bytes(1, 2);
  type = "public-key";
  authenticatorAttachment = "platform";
  constructor(public response: FakeAttestation | FakeAssertion) {}
  getClientExtensionResults() {
    return { credProps: { rk: true } };
  }
}

function bytes(...values: number[]): ArrayBuffer {
  return new Uint8Array(values).buffer;
}

const create = vi.fn<(options: CredentialCreationOptions) => Promise<unknown>>();
const get = vi.fn<(options: CredentialRequestOptions) => Promise<unknown>>();

beforeEach(() => {
  vi.stubGlobal("PublicKeyCredential", FakeCredential);
  vi.stubGlobal("AuthenticatorAttestationResponse", FakeAttestation);
  vi.stubGlobal("AuthenticatorAssertionResponse", FakeAssertion);
  Object.defineProperty(navigator, "credentials", { configurable: true, value: { create, get } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const creationOptions = {
  publicKey: {
    challenge: "AAEC_-8",
    rp: { id: "localhost", name: "Lest" },
    user: { id: "dXNlcg", name: "a@example.com", displayName: "a@example.com" },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    excludeCredentials: [{ id: "AQI", type: "public-key", transports: ["internal"] }],
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    extensions: { credProps: true },
  },
};

const requestOptions = {
  publicKey: { challenge: "AAEC_-8", rpId: "localhost", userVerification: "preferred" },
};

describe("base64url", () => {
  it("encode sans remplissage, avec l'alphabet des URL", () => {
    expect(toBase64Url(bytes(0, 1, 2, 255, 239))).toBe("AAEC_-8");
  });
});

describe("createPasskey", () => {
  it("décode les champs binaires des options et encode la réponse", async () => {
    create.mockResolvedValue(new FakeCredential(new FakeAttestation()));

    const credential = await createPasskey(creationOptions);

    const publicKey = create.mock.calls[0]?.[0].publicKey;
    expect(new Uint8Array(publicKey?.challenge as ArrayBuffer)).toEqual(
      new Uint8Array([0, 1, 2, 255, 239]),
    );
    expect(new TextDecoder().decode(publicKey?.user.id as ArrayBuffer)).toBe("user");
    expect(new Uint8Array(publicKey?.excludeCredentials?.[0]?.id as ArrayBuffer)).toEqual(
      new Uint8Array([1, 2]),
    );
    expect(publicKey?.authenticatorSelection?.residentKey).toBe("required");
    expect(credential).toEqual({
      id: "AQI",
      rawId: "AQI",
      type: "public-key",
      authenticatorAttachment: "platform",
      clientExtensionResults: { credProps: { rk: true } },
      response: { clientDataJSON: "AQI", attestationObject: "AwQ", transports: ["internal"] },
    });
  });

  it.each([
    ["NotAllowedError", PASSKEY_CANCELLED],
    ["InvalidStateError", PASSKEY_ALREADY_ADDED],
    ["SecurityError", PASSKEY_FAILED],
  ])("traduit %s", async (name, message) => {
    create.mockRejectedValue(new DOMException("refus", name));
    await expect(createPasskey(creationOptions)).rejects.toThrow(message);
  });

  it("refuse des options inattendues sans appeler le navigateur", async () => {
    await expect(createPasskey({ publicKey: { challenge: 1 } })).rejects.toThrow(PASSKEY_FAILED);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("getPasskey", () => {
  it("encode l'assertion, identifiant utilisateur compris", async () => {
    get.mockResolvedValue(new FakeCredential(new FakeAssertion(bytes(9))));

    const credential = await getPasskey(requestOptions);

    expect(get.mock.calls[0]?.[0].publicKey?.allowCredentials).toEqual([]);
    expect(credential.response).toEqual({
      clientDataJSON: "AQ",
      authenticatorData: "BQ",
      signature: "Bgc",
      userHandle: "CQ",
    });
  });

  it("garde un identifiant utilisateur absent (clé de second facteur)", async () => {
    get.mockResolvedValue(new FakeCredential(new FakeAssertion(null)));
    const credential = await getPasskey(requestOptions);
    expect(credential.response).toMatchObject({ userHandle: null });
  });

  it("une annulation n'est pas une panne", async () => {
    get.mockRejectedValue(new DOMException("annulé", "NotAllowedError"));
    await expect(getPasskey(requestOptions)).rejects.toThrow(PASSKEY_CANCELLED);
  });

  it("refuse une réponse qui n'est pas une assertion", async () => {
    get.mockResolvedValue(new FakeCredential(new FakeAttestation()));
    await expect(getPasskey(requestOptions)).rejects.toThrow(PASSKEY_FAILED);
  });
});
