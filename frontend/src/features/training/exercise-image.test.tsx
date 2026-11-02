import { render, screen } from "@testing-library/react";

import { ExerciseImage } from "./exercise-image";

const IMAGE = {
  url: `/api/v1/exercise-images/${"a".repeat(64)}.webp`,
  license: "CC-BY-SA 4",
  license_author: "Jane",
};

describe("ExerciseImage", () => {
  it("affiche l'image normalisée, décorative par défaut (le nom est à côté)", () => {
    const { container } = render(<ExerciseImage image={IMAGE} category="chest" size="thumb" />);

    const img = container.querySelector("img");
    expect(img).toHaveAttribute("src", IMAGE.url);
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(container.querySelector("source")).toHaveAttribute("type", "image/webp");
    expect(screen.queryByRole("img")).toBeNull();
    // Aucun attribut `style` : refusé par la CSP de prod.
    expect(container.querySelector("[style]")).toBeNull();
  });

  it("décrit l'image quand elle est seule, comme sur la fiche", () => {
    render(
      <ExerciseImage
        image={IMAGE}
        category="chest"
        size="large"
        alt="Illustration de l’exercice"
      />,
    );

    expect(screen.getByRole("img", { name: "Illustration de l’exercice" })).toHaveAttribute(
      "loading",
      "eager",
    );
  });

  it("superpose la seconde position sans attribut style (CSP)", () => {
    const peak = { ...IMAGE, url: `/api/v1/exercise-images/${"b".repeat(64)}.webp` };
    const { container } = render(
      <ExerciseImage
        image={IMAGE}
        alternate={peak}
        category="chest"
        size="large"
        alt="Mouvement"
      />,
    );

    const images = container.querySelectorAll("img");
    expect([...images].map((img) => img.getAttribute("src"))).toEqual([IMAGE.url, peak.url]);
    expect(container.querySelector("[style]")).toBeNull();
  });

  it("remplace une image absente par le pictogramme de la catégorie", () => {
    const { container, rerender } = render(
      <ExerciseImage image={null} category="legs" size="small" />,
    );

    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("img")).toBeNull();

    rerender(<ExerciseImage image={null} category="legs" size="large" alt="Squat" />);
    expect(screen.getByRole("img", { name: "Squat" })).toBeInTheDocument();
  });
});
