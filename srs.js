// Leitner 5 盒。純函式,不碰 DOM、不碰 store。
// box 1 一律「現在就 due」(新字 + 答錯回到 box 1)。
export const INTERVALS = [null, 0, 1, 3, 7, 14]; // 1-indexed,index 1..5
const DAY = 86_400_000;

export function isDue(w, now = Date.now()) {
  if (!w || w.deleted) return false;
  if (w.last_reviewed == null) return true;
  const interval = INTERVALS[w.box] ?? 0;
  return now - w.last_reviewed >= interval * DAY;
}

function stamp(w) {
  const now = Date.now();
  return { ...w, last_reviewed: now, seen: (w.seen ?? 0) + 1, updated_at: now };
}

export function gradeCorrect(w) {
  const next = stamp(w);
  next.correct = (w.correct ?? 0) + 1;
  next.box = Math.min((w.box ?? 1) + 1, 5);
  return next;
}

export function gradeWrong(w) {
  const next = stamp(w);
  next.box = 1;
  return next;
}

// 出題排序:box asc → last_reviewed asc(null 最前)→ 同層 Fisher-Yates 打亂。
// 不需要可重現,所以直接用 Math.random;打亂只在「同 box + 同 last_reviewed」桶內進行。
export function sortDue(words, now = Date.now()) {
  const due = words.filter((w) => isDue(w, now));
  due.sort((a, b) => {
    if (a.box !== b.box) return a.box - b.box;
    const al = a.last_reviewed ?? -1;
    const bl = b.last_reviewed ?? -1;
    return al - bl;
  });

  const out = [];
  let i = 0;
  while (i < due.length) {
    let j = i;
    while (
      j < due.length &&
      due[j].box === due[i].box &&
      (due[j].last_reviewed ?? -1) === (due[i].last_reviewed ?? -1)
    ) {
      j++;
    }
    const bucket = due.slice(i, j);
    for (let k = bucket.length - 1; k > 0; k--) {
      const r = Math.floor(Math.random() * (k + 1));
      [bucket[k], bucket[r]] = [bucket[r], bucket[k]];
    }
    out.push(...bucket);
    i = j;
  }
  return out;
}

// 「我不會的字」queue。不走 SRS,只挑符合「struggling」訊號的字。
// 條件(任一成立):
//   1) box == 1 且 seen >= 1 — 練過至少一次但停在 box 1(答錯回原點 / 從未答對)
//   2) box == 2 且 seen >= 2 — 剛 promote 但累積資料還不穩
//   3) seen >= 3 且 correct/seen < 0.5 — 累積正確率低於一半(門檻 3 次,避免單次失誤誤判)
// 排序:正確率升冪(越爛越前)→ seen 降冪(練越多越前)→ box 升冪
export function sortWeak(words) {
  const matching = words.filter((w) => {
    if (!w || w.deleted) return false;
    const seen = w.seen ?? 0;
    if (seen === 0) return false;
    const acc = (w.correct ?? 0) / seen;
    const box = w.box ?? 1;
    if (box === 1 && seen >= 1) return true;
    if (box === 2 && seen >= 2) return true;
    if (seen >= 3 && acc < 0.5) return true;
    return false;
  });
  matching.sort((a, b) => {
    const accA = a.seen ? (a.correct ?? 0) / a.seen : 1;
    const accB = b.seen ? (b.correct ?? 0) / b.seen : 1;
    if (accA !== accB) return accA - accB;
    if ((b.seen ?? 0) !== (a.seen ?? 0)) return (b.seen ?? 0) - (a.seen ?? 0);
    return (a.box ?? 1) - (b.box ?? 1);
  });
  return matching;
}

// Levenshtein 用在拼寫模式判「差一點點」(≤1)。輸入小,直接 DP。
export function levenshtein(a, b) {
  a = a.toLowerCase();
  b = b.toLowerCase();
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    let curr = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const next = Math.min(curr + 1, prev[j] + 1, prev[j - 1] + cost);
      prev[j - 1] = curr;
      curr = next;
    }
    prev[n] = curr;
  }
  return prev[n];
}
