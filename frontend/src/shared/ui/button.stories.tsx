import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { Button } from "./button";

const meta = {
  title: "Base/Button",
  component: Button,
  args: { children: "Valider la série 3", onClick: fn() },
  argTypes: {
    variant: { control: "inline-radio", options: ["primary", "secondary", "ghost"] },
    size: { control: "inline-radio", options: ["md", "lg"] },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

/** L'action principale de l'écran, en bas, dans la zone du pouce. */
export const Principal: Story = {
  args: { variant: "primary", size: "lg", block: true },
  play: async ({ args, canvasElement }) => {
    const button = within(canvasElement).getByRole("button", { name: "Valider la série 3" });
    // Garde-fou : les tokens sont réellement appliqués (fond jaune, 64 px de haut).
    await expect(getComputedStyle(button).backgroundColor).toBe("rgb(242, 194, 48)");
    await expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(64);
    // `document.fonts.ready` peut se résoudre avant le début du téléchargement : on force le
    // chargement de la police réellement utilisée par le bouton, puis on vérifie qu'elle existe.
    const { fontFamily, fontWeight, fontSize } = getComputedStyle(button);
    await expect(fontFamily).toMatch(/Archivo/);
    const loaded = await document.fonts.load(`${fontWeight} ${fontSize} ${fontFamily}`);
    await expect(loaded.some((face) => face.family.includes("Archivo"))).toBe(true);
    await userEvent.click(button);
    await expect(args.onClick).toHaveBeenCalledOnce();
  },
};

export const Secondaire: Story = {
  args: { variant: "secondary", children: "Ajouter un exercice" },
};

export const Discret: Story = {
  args: { variant: "ghost", children: "Passer" },
};

export const Desactive: Story = {
  name: "Désactivé",
  args: { variant: "primary", size: "lg", block: true, disabled: true },
};
