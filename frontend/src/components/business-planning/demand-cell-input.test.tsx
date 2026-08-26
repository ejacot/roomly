import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DemandCellInput } from "./demand-cell-input";

describe("DemandCellInput", () => {
  it("commits once when Enter moves focus and causes blur", () => {
    const onCommit = vi.fn();
    render(
      <div>
        <DemandCellInput value={4} label="Monday rooms" cellKey="0:0" onCommit={onCommit} />
        <DemandCellInput value={3} label="Tuesday rooms" cellKey="0:1" onCommit={vi.fn()} />
      </div>,
    );

    const input = screen.getByRole("spinbutton", { name: "Monday rooms" });
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(5);
    expect(screen.getByRole("spinbutton", { name: "Tuesday rooms" })).toHaveFocus();
  });

  it("clears on focus and restores the current value when blurred without an edit", () => {
    const onCommit = vi.fn();
    render(<DemandCellInput value={4} label="Monday rooms" cellKey="0:0" onCommit={onCommit} />);

    const input = screen.getByRole<HTMLInputElement>("spinbutton", { name: "Monday rooms" });
    fireEvent.focus(input);
    expect(input).toHaveValue(null);

    fireEvent.blur(input);
    expect(input).toHaveValue(4);
    expect(onCommit).not.toHaveBeenCalled();
  });
});
