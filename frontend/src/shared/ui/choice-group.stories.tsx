import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";

import { ChoiceGroup } from "./choice-group";

const RPE = [7, 7.5, 8, 8.5, 9].map((value) => ({ value, label: String(value).replace(".", ",") }));

/** Choix du RPE piloté par un état local, comme dans l'écran de séance. */
function Rpe({ initial }: { initial?: number }) {
  const [rpe, setRpe] = useState(initial);
  return <ChoiceGroup legend="Effort ressenti (RPE)" options={RPE} value={rpe} onChange={setRpe} />;
}

const meta = {
  title: "Séance/ChoiceGroup",
  component: Rpe,
  args: { initial: 8 },
} satisfies Meta<typeof Rpe>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EffortRessenti: Story = {
  name: "Effort ressenti (RPE)",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("radio", { name: "8" })).toBeChecked();
    canvas.getByRole("radio", { name: "8" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(canvas.getByRole("radio", { name: "8,5" })).toBeChecked();
    // L'option cochée est réellement mise en évidence (fond inversé), pas seulement cochée.
    const checkedLabel = canvas.getByText("8,5");
    await expect(getComputedStyle(checkedLabel).backgroundColor).not.toBe(
      getComputedStyle(canvas.getByText("8")).backgroundColor,
    );
  },
};

export const SansChoix: Story = {
  name: "Aucun choix",
  args: { initial: undefined },
};

const GOALS = [
  { value: "gain", label: "Prise de masse" },
  { value: "maintain", label: "Maintien" },
  { value: "cut", label: "Sèche" },
] as const;

function Goal() {
  const [goal, setGoal] = useState<(typeof GOALS)[number]["value"]>("gain");
  return (
    <ChoiceGroup
      legend="Objectif"
      options={GOALS}
      value={goal}
      onChange={setGoal}
      layout="column"
    />
  );
}

/** Libellés longs : une option par ligne, pleine largeur. */
export const EnColonne: Story = {
  name: "En colonne (objectif)",
  render: () => <Goal />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const option = canvas.getByText("Sèche");
    await expect(option.getBoundingClientRect().height).toBeGreaterThanOrEqual(56);
    await userEvent.click(option);
    await expect(canvas.getByRole("radio", { name: "Sèche" })).toBeChecked();
  },
};
