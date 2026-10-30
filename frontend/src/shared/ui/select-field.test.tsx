import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SelectField } from "./select-field";

describe("SelectField", () => {
  it("relie le libellé visible à la liste et se pilote au clavier", async () => {
    const onChange = vi.fn();
    render(
      <SelectField label="Catégorie" defaultValue="" onChange={onChange}>
        <option value="">Toutes</option>
        <option value="legs">Jambes</option>
      </SelectField>,
    );

    const select = screen.getByRole("combobox", { name: "Catégorie" });
    await userEvent.selectOptions(select, "Jambes");

    expect(select).toHaveValue("legs");
    expect(onChange).toHaveBeenCalledOnce();
  });
});
