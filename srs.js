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
