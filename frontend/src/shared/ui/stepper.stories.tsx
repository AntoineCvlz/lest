import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";

import { Stepper, type StepperProps } from "./stepper";

/** Stepper piloté par un état local, comme dans l'écran de séance. */
function Controlled(props: Omit<StepperProps, "onChange">) {
  const [value, setValue] = useState(props.value);
  return <Stepper {...props} value={value} onChange={setValue} />;
}

const meta = {
  title: "Séance/Stepper",
  component: Controlled,
  args: {
    label: "Charge",
    value: 82.5,
    step: 2.5,
    min: 20,
    unit: "kilos",
    stepUnit: "kilos",
    size: "lg",
  },
} satisfies Meta<typeof Controlled>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Charge: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "+2,5 kilos" }));
    await expect(canvas.getByRole("status")).toHaveTextContent("85");
    // Au clavier : focus sur « −2,5 », puis Entrée.
    canvas.getByRole("button", { name: "−2,5 kilos" }).focus();
    await userEvent.keyboard("{Enter}");
    await expect(canvas.getByRole("status")).toHaveTextContent("82,5");
  },
};

export const Repetitions: Story = {
  name: "Répétitions",
  args: {
    label: "Répétitions",
    value: 7,
    step: 1,
    min: 0,
    unit: "répétitions",
    stepUnit: "répétition",
    size: "md",
  },
};

export const BarreSeule: Story = {
  name: "Barre seule (minimum)",
  args: { value: 20 },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("button", { name: "−2,5 kilos" })).toBeDisabled();
  },
};
