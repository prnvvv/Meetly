import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  AVATAR_VARIANT_COUNT,
  ParticipantAvatar,
  avatarVariantFor,
} from "./ParticipantAvatar";

afterEach(cleanup);

describe("ParticipantAvatar", () => {
  it("exposes an accessible label", () => {
    render(<ParticipantAvatar name="Asha Rao" />);
    expect(screen.getByRole("img", { name: "Asha Rao avatar" })).toBeTruthy();
  });

  it("picks the same illustration for the same person every time", () => {
    expect(avatarVariantFor("Asha Rao")).toBe(avatarVariantFor("  asha rao "));
  });

  it("always resolves to an existing illustration", () => {
    for (const name of ["", "A", "Asha", "Rahul Verma", "山田 太郎", "x".repeat(200)]) {
      const variant = avatarVariantFor(name);
      expect(variant).toBeGreaterThanOrEqual(0);
      expect(variant).toBeLessThan(AVATAR_VARIANT_COUNT);
    }
  });

  it("spreads different names across several illustrations", () => {
    const names = ["Asha", "Rahul", "Priya", "Marcus", "Lena", "Omar", "Chen", "Ivy"];
    const variants = new Set(names.map(avatarVariantFor));
    expect(variants.size).toBeGreaterThan(2);
  });

  it("can force a variant and wraps out-of-range values", () => {
    const { container, rerender } = render(<ParticipantAvatar name="A" variant={2} />);
    expect(container.querySelector("[data-variant='2']")).toBeTruthy();
    rerender(<ParticipantAvatar name="A" variant={AVATAR_VARIANT_COUNT + 1} />);
    expect(container.querySelector("[data-variant='1']")).toBeTruthy();
  });

  it("renders the three-line accent unless disabled", () => {
    const { container, rerender } = render(<ParticipantAvatar name="A" />);
    expect(container.querySelector(".p-avatar__accent")).toBeTruthy();
    rerender(<ParticipantAvatar name="A" accent={false} />);
    expect(container.querySelector(".p-avatar__accent")).toBeNull();
  });

  it("supports a fixed pixel size", () => {
    const { container } = render(<ParticipantAvatar name="A" size={40} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.getPropertyValue("--p-size")).toBe("40px");
  });

  it("uses an existing Meetly illustration, never initials", () => {
    const { container } = render(<ParticipantAvatar name="You" />);
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toMatch(/^\/images\/avatars\/avatar-\d\.png$/);
    expect(container.textContent).toBe("");
  });

  it("prefers a real profile photo over the illustration", () => {
    const { container } = render(
      <ParticipantAvatar name="Asha" imageUrl="https://img.example/asha.png" />
    );
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://img.example/asha.png"
    );
    expect(container.querySelector("[data-variant='photo']")).toBeTruthy();
  });
});
