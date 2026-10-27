export type DiffPart = { op: 'same' | 'del' | 'ins'; text: string };

/** Word-level diff (LCS over words and the spaces between them). Blocks are short, so O(n·m) is fine. */
export function wordDiff(a: string, b: string): DiffPart[] {
  const A = a.match(/\s+|[^\s]+/g) ?? [], B = b.match(/\s+|[^\s]+/g) ?? [];
  const n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: DiffPart[] = [];
  const push = (op: DiffPart['op'], text: string) => {
    const last = out[out.length - 1];
    if (last?.op === op) last.text += text; else out.push({ op, text });
  };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { push('same', A[i]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) push('del', A[i++]);
    else push('ins', B[j++]);
  }
  while (i < n) push('del', A[i++]);
  while (j < m) push('ins', B[j++]);
  // a lone space between two changes reads better as part of the change: "a b" → "c d", not "a"→"c" " " "b"→"d"
  const res: DiffPart[] = [];
  for (let k = 0; k < out.length; k++) {
    const p = out[k];
    if (p.op === 'same' && /^\s+$/.test(p.text) && res.length && res[res.length - 1].op !== 'same' && out[k + 1] && out[k + 1].op !== 'same') {
      const parts: DiffPart[] = [{ op: 'del', text: p.text }, { op: 'ins', text: p.text }];
      for (const q of parts) merge(res, q);
    } else merge(res, { ...p });
  }
  // keep deletions before insertions inside each changed run
  const final: DiffPart[] = [];
  for (let k = 0; k < res.length; k++) {
    if (res[k].op === 'same') { final.push(res[k]); continue; }
    let del = '', ins = '';
    for (; k < res.length && res[k].op !== 'same'; k++) res[k].op === 'del' ? (del += res[k].text) : (ins += res[k].text);
    k--;
    if (del) final.push({ op: 'del', text: del });
    if (ins) final.push({ op: 'ins', text: ins });
  }
  return final;
}

function merge(list: DiffPart[], p: DiffPart) {
  const last = list[list.length - 1];
  if (last?.op === p.op) last.text += p.text; else list.push(p);
}
