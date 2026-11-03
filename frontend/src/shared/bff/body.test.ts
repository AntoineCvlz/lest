import { readBody } from "./body";

function streamed(chunks: number[]): Request {
  // Envoi découpé, sans `Content-Length` : seule la lecture peut le borner.
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const size of chunks) controller.enqueue(new Uint8Array(size).fill(1));
      controller.close();
    },
  });
  return new Request("http://localhost/api/v1/x/", {
    method: "PUT",
    body: stream,
    duplex: "half",
  } as RequestInit);
}

describe("readBody", () => {
  it("rend le corps entier sous la limite", async () => {
    const body = await readBody(
      new Request("http://localhost/", { method: "PUT", body: "abc" }),
      10,
    );

    expect(new TextDecoder().decode(body ?? new ArrayBuffer(0))).toBe("abc");
  });

  it("refuse un corps annoncé trop gros sans le lire", async () => {
    const request = new Request("http://localhost/", {
      method: "PUT",
      body: "abc",
      headers: { "content-length": "11" },
    });

    expect(await readBody(request, 10)).toBeNull();
  });

  it("refuse un corps découpé qui dépasse en cours de lecture", async () => {
    expect(await readBody(streamed([6, 6]), 10)).toBeNull();
    expect((await readBody(streamed([4, 6]), 10))?.byteLength).toBe(10);
  });

  it("rend un corps vide pour une requête sans corps", async () => {
    expect(
      (await readBody(new Request("http://localhost/", { method: "DELETE" })))?.byteLength,
    ).toBe(0);
  });
});
