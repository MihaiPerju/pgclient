export type JsonTokenKind = "key" | "string" | "number" | "literal" | "plain";

export interface JsonToken {
  kind: JsonTokenKind;
  text: string;
}

const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b/g;

export const looksLikeJson = (value: string) => /^\s*[{[]/.test(value);

/** The value laid out over lines, or null when it is not an object or an array, which is all a cell is opened for. */
export function prettyJson(value: string): string | null {
  if (!looksLikeJson(value)) return null;
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return null;
  }
}

/** Splits text laid out by prettyJson into the pieces that are coloured alike. */
export function tokenizeJson(pretty: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let end = 0;
  for (const match of pretty.matchAll(TOKEN)) {
    if (match.index > end) tokens.push({ kind: "plain", text: pretty.slice(end, match.index) });
    const [text, quoted, colon] = match;
    if (quoted === undefined) {
      tokens.push({ kind: /^[-\d]/.test(text) ? "number" : "literal", text });
    } else if (colon === undefined) {
      tokens.push({ kind: "string", text });
    } else {
      tokens.push({ kind: "key", text: quoted }, { kind: "plain", text: colon });
    }
    end = match.index + text.length;
  }
  if (end < pretty.length) tokens.push({ kind: "plain", text: pretty.slice(end) });
  return tokens;
}
