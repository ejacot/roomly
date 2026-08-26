import { Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";

type Props = {
  value: number;
  label: string;
  cellKey: string;
  disabled?: boolean;
  busy?: boolean;
  onCommit: (value: number) => void;
  onPaste?: (text: string) => void;
};

export function DemandCellInput({
  value,
  label,
  cellKey,
  disabled = false,
  busy = false,
  onCommit,
  onPaste,
}: Props) {
  const [draft, setDraft] = useState(String(value));
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (!dirty) setDraft(String(value));
  }, [dirty, value]);

  const commit = () => {
    if (!dirtyRef.current) {
      setDraft(String(value));
      return;
    }
    if (draft === "") {
      dirtyRef.current = false;
      setDirty(false);
      setDraft(String(value));
      return;
    }
    const parsed = clampWorkers(Number(draft));
    dirtyRef.current = false;
    setDraft(String(parsed));
    setDirty(false);
    if (parsed !== value) onCommit(parsed);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setDraft(String(value));
      dirtyRef.current = false;
      setDirty(false);
      event.currentTarget.blur();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
      focusNextDemandCell(event.currentTarget);
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData("text/plain");
    if (!onPaste || (!text.includes("\t") && !text.includes("\n"))) return;
    event.preventDefault();
    onPaste(text);
  };

  const step = (amount: number) => {
    const current = draft === "" ? value : Number(draft);
    const next = clampWorkers(current + amount);
    setDraft(String(next));
    dirtyRef.current = false;
    setDirty(false);
    if (next !== value) onCommit(next);
  };

  return (
    <div className="demand-cell-input" data-busy={busy || undefined}>
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled || busy || Number(draft) <= 0}
        onClick={() => step(-1)}
        aria-label={`${label}: -1`}
      >
        <Minus aria-hidden="true" />
      </button>
      <input
        type="number"
        min="0"
        max="99"
        step="1"
        inputMode="numeric"
        pattern="[0-9]*"
        aria-label={label}
        data-demand-cell={cellKey}
        disabled={disabled || busy}
        value={draft}
        onFocus={() => {
          if (!dirtyRef.current) setDraft("");
        }}
        onChange={(event) => {
          setDraft(event.target.value.replace(/[^0-9]/g, "").slice(0, 2));
          dirtyRef.current = true;
          setDirty(true);
        }}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled || busy || Number(draft) >= 99}
        onClick={() => step(1)}
        aria-label={`${label}: +1`}
      >
        <Plus aria-hidden="true" />
      </button>
    </div>
  );
}

function clampWorkers(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(99, Math.round(value)));
}

function focusNextDemandCell(current: HTMLInputElement) {
  const cells = Array.from(document.querySelectorAll<HTMLInputElement>("[data-demand-cell]"))
    .filter((cell) => !cell.disabled);
  const index = cells.indexOf(current);
  if (index >= 0 && cells[index + 1]) {
    cells[index + 1].focus();
    cells[index + 1].select();
  }
}
