import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";

import { TextField } from "./text-field";

const meta = {
  title: "Base/TextField",
  component: TextField,
  args: { label: "Adresse e-mail", type: "email", autoComplete: "email" },
} satisfies Meta<typeof TextField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Vide: Story = {
  play: async ({ canvasElement }) => {
    const field = within(canvasElement).getByRole("textbox", { name: "Adresse e-mail" });
    // Garde-fou : tokens réellement appliqués (fond acier, 56 px, Archivo).
    const style = getComputedStyle(field);
    await expect(style.backgroundColor).toBe("rgb(36, 48, 59)");
    await expect(field.getBoundingClientRect().height).toBeGreaterThanOrEqual(56);
    await expect(style.fontFamily).toMatch(/Archivo/);
    await userEvent.type(field, "membre@example.com");
    await expect(field).toHaveValue("membre@example.com");
  },
};

export const AvecAide: Story = {
  name: "Avec aide",
  args: { label: "Mot de passe", type: "password", hint: "12 caractères au moins." },
};

export const EnErreur: Story = {
  name: "En erreur",
  args: { defaultValue: "membre@", error: "Saisissez une adresse e-mail complète." },
};

export const Desactive: Story = {
  name: "Désactivé",
  args: { defaultValue: "membre@example.com", disabled: true },
};
