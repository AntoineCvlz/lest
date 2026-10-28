/**
 * Lecture des e-mails capturés par Mailpit (service `mailpit` de la stack Compose), pour les
 * parcours qui reçoivent un code. API : https://mailpit.axllent.org/docs/api-v1/
 */

const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://localhost:8025";
const CODE = /^\s*([A-Z0-9]{4}-[A-Z0-9]{4})\s*$/m;

interface MessageSummary {
  ID: string;
}

async function json<T>(path: string): Promise<T> {
  const response = await fetch(`${MAILPIT_URL}${path}`);
  if (!response.ok) throw new Error(`Mailpit ${path} : ${String(response.status)}`);
  return (await response.json()) as T;
}

/**
 * Code à usage unique (« ABCD-EFGH ») du dernier e-mail reçu par `address`.
 *
 * `except` : code d’un e-mail précédent, à ignorer tant que le nouvel e-mail n’est pas arrivé.
 */
export async function lastCodeSentTo(
  address: string,
  { except, timeoutMs = 15_000 }: { except?: string; timeoutMs?: number } = {},
): Promise<string> {
  const query = encodeURIComponent(`to:"${address}"`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { messages } = await json<{ messages: MessageSummary[] }>(
      `/api/v1/search?query=${query}&limit=1`,
    );
    const latest = messages[0];
    if (latest) {
      const { Text } = await json<{ Text: string }>(`/api/v1/message/${latest.ID}`);
      const code = CODE.exec(Text)?.[1];
      if (code && code !== except) return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Aucun code reçu par ${address} dans Mailpit`);
}
