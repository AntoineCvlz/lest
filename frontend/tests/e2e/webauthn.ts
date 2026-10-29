import type { Page } from "@playwright/test";

/**
 * Authentificateur virtuel de Chromium (CDP), comme une passkey d'appareil : clé résidente et
 * vérification de l'utilisateur (PIN, biométrie) toujours réussie, sans fenêtre à valider.
 * Les cérémonies sont réelles : le serveur vérifie origine, défi et signature.
 */
export async function addVirtualAuthenticator(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}
