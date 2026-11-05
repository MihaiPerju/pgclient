import { useRef, useState, type KeyboardEvent } from "react";

interface Props {
  value: string | null;
  onCommit: (text: string) => void;
  onCancel: () => void;
}

/** A cell edited where it sits: Enter or clicking away keeps what was typed, Escape drops it. */
export function InlineCellEditor({ value, onCommit, onCancel }: Props) {
  const [text, setText] = useState(value ?? "");
  // Pressing Enter ends the edit and the input goes, which in some webviews is reported as clicking away too.
  const finished = useRef(false);

  function finish(end: () => void) {
    if (finished.current) return;
    finished.current = true;
    end();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // The grid listens for copy, select all and Escape, which here belong to the text being typed.
    event.stopPropagation();
    if (event.key === "Enter") finish(() => onCommit(text));
    else if (event.key === "Escape") finish(onCancel);
  }

  return (
    <input
      autoFocus
      aria-label="Edit cell"
      value={text}
      spellCheck={false}
      onChange={(event) => setText(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={() => finish(() => onCommit(text))}
      onKeyDown={onKeyDown}
      // Clicking into the text to place the cursor must not start selecting cells under it.
      onMouseDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      style={{ width: "100%", height: "100%", minWidth: 0, padding: 0, border: 0, outline: "none", background: "transparent", color: "inherit", font: "inherit" }}
    />
  );
}
