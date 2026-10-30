import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";

import { SelectField } from "./select-field";

const meta = {
  title: "UI/SelectField",
  component: SelectField,
  args: {
    label: "Catégorie",
    defaultValue: "",
    children: (
      <>
        <option value="">Toutes</option>
        <option value="chest">Pectoraux</option>
        <option value="legs">Jambes</option>
      </>
    ),
  },
} satisfies Meta<typeof SelectField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const select = within(canvasElement).getByRole("combobox", { name: "Catégorie" });
    // Rendu réel : 56 px de haut (un HTML sans style passerait axe).
    await expect(select.getBoundingClientRect().height).toBeGreaterThanOrEqual(56);
  },
};

export const Disabled: Story = { args: { disabled: true } };
