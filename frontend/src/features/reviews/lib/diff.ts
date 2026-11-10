export type DiffPart = { type: "same" | "add" | "del"; text: string };

const tokenize = (s: string) => s.match(/\s+|\S+/g) ?? [];

/**
 * Word-level difference between two drafts. Common start and end are trimmed first, so editing one phrase in a long
 * draft stays cheap. Returns null when the middle that is left is too large to compare in the browser.
 */
export function diffWords(before: string, after: string): DiffPart[] | null {
  const a = tokenize(before), b = tokenize(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const midA = a.slice(start, endA), midB = b.slice(start, endB);
  if (midA.length * midB.length > 4_000_000) return null;

  // longest common subsequence of the differing middle
  const w = midB.length + 1;
  const lcs = new Uint32Array((midA.length + 1) * w);
  for (let i = midA.length - 1; i >= 0; i--)
    for (let j = midB.length - 1; j >= 0; j--)
      lcs[i * w + j] = midA[i] === midB[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);

  const parts: DiffPart[] = [];
  const push = (type: DiffPart["type"], text: string) => {
    const last = parts[parts.length - 1];
    if (last && last.type === type) last.text += text; else parts.push({ type, text });
  };
  a.slice(0, start).forEach(t => push("same", t));
  let i = 0, j = 0;
  while (i < midA.length && j < midB.length) {
    if (midA[i] === midB[j]) { push("same", midA[i]); i++; j++; }
    else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) push("del", midA[i++]);
    else push("add", midB[j++]);
  }
  while (i < midA.length) push("del", midA[i++]);
  while (j < midB.length) push("add", midB[j++]);
  a.slice(endA).forEach(t => push("same", t));
  return parts;
}
