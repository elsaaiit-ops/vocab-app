// 本地優先的小型同步引擎。
// 設計三原則:
//   1) 讀寫先打 localStorage,UI 馬上反映 → 離線也能用。
//   2) 所有寫入丟一份進 pendingOps(以 id 去重,留最新),回線時批次 upsert。
//   3) sync() 先 push 再 pull,合併採 last-write-wins(`updated_at` 大者勝)。
//      刪除走 deleted:true + upsert,避免「離線刪、回線又 pull 回來」。
import { getUser, pushUpserts, pullAll } from "./supabase.js";
import { gradeCorrect, gradeWrong } from "./srs.js";

const LS_KEY = "vocab-app";
const SYNC_INTERVAL_MS = 30_000;

const DEFAULT_STATE = () => ({
  words: [],
  pendingOps: [],
  settings: { typoTolerance: true },
  lastSyncAt: null,
});

// --- localStorage I/O --------------------------------------------
function read() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_STATE();
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_STATE(), ...parsed };
  } catch (e) {
    console.warn("[store] localStorage parse failed,改用空狀態", e);
    return DEFAULT_STATE();
  }
}

function write(state) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch (e) {
    console.error("[store] localStorage write failed", e);
  }
}

// 記憶體層 cache,避免每次都 JSON.parse。
let state = read();

function emitChanged() {
  window.dispatchEvent(new CustomEvent("vocab:changed"));
}

function persist() {
  write(state);
  emitChanged();
}

// --- pendingOps: 以 id 去重,留最新一份(完整 upsert) -----------
function enqueue(word) {
  const idx = state.pendingOps.findIndex((p) => p.id === word.id);
  if (idx >= 0) state.pendingOps[idx] = word;
  else state.pendingOps.push(word);
}

// --- Public API ---------------------------------------------------
export function loadState() {
  return state;
}

export function getSettings() {
  return state.settings;
}

export function setSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  persist();
}

// 全部單字(包含 deleted:true,內部 / 備份用)
export function getAllIncludingDeleted() {
  return state.words.slice();
}

// UI 用:過濾掉軟刪除的
export function getWords() {
  return state.words.filter((w) => !w.deleted);
}

export function getWordById(id) {
  return state.words.find((w) => w.id === id) ?? null;
}

// 大小寫不敏感的「相同 word」查找(去重用)
export function findByWord(word) {
  const k = (word ?? "").trim().toLowerCase();
  if (!k) return null;
  return state.words.find((w) => !w.deleted && (w.word ?? "").trim().toLowerCase() === k) ?? null;
}

// 新增一筆字。回 { word, dedupedTo } — 重複時不新增,把既有那筆回給呼叫端。
export function addWord(partial) {
  const dup = findByWord(partial.word);
  if (dup) return { word: dup, dedupedTo: dup };

  const now = Date.now();
  const w = {
    id: crypto.randomUUID(),
    user_id: null, // server 端 / supabase.js push 時補
    word: (partial.word ?? "").trim(),
    meaning: (partial.meaning ?? "").trim(),
    example: (partial.example ?? "").trim(),
    part_of_speech: (partial.part_of_speech ?? "").trim(),
    source: partial.source ?? "manual",
    box: 1,
    last_reviewed: null,
    seen: 0,
    correct: 0,
    deleted: false,
    updated_at: now,
  };
  state.words.push(w);
  enqueue(w);
  persist();
  sync();
  return { word: w, dedupedTo: null };
}

// 答題後更新 box / seen / correct / updated_at
export function gradeWord(id, correctBool) {
  const i = state.words.findIndex((w) => w.id === id);
  if (i < 0) return null;
  const next = correctBool ? gradeCorrect(state.words[i]) : gradeWrong(state.words[i]);
  state.words[i] = next;
  enqueue(next);
  persist();
  sync();
  return next;
}

// 軟刪除
export function deleteWord(id) {
  const i = state.words.findIndex((w) => w.id === id);
  if (i < 0) return null;
  const next = { ...state.words[i], deleted: true, updated_at: Date.now() };
  state.words[i] = next;
  enqueue(next);
  persist();
  sync();
  return next;
}

// 匯入(備份還原 / 字表匯入由 UI 端各自呼叫 addWord;這個是「直接合併整批」用的)
// rows: Word[] 陣列。對每筆:
//   - 若已有相同 id 且本地 updated_at 較大 → 略過
//   - 否則 → 取代並 enqueue
// 回傳 { added, updated, skipped }
export function mergeImport(rows) {
  let added = 0, updated = 0, skipped = 0;
  const now = Date.now();
  for (const r of rows) {
    if (!r || !r.id) {
      // 沒 id 的當「新增」,但要去重
      const dup = findByWord(r?.word);
      if (dup) { skipped++; continue; }
      addWord({ ...r, source: r?.source ?? "list" });
      added++;
      continue;
    }
    const idx = state.words.findIndex((w) => w.id === r.id);
    if (idx < 0) {
      const merged = { ...r, updated_at: r.updated_at ?? now };
      state.words.push(merged);
      enqueue(merged);
      added++;
    } else {
      const local = state.words[idx];
      const incomingTs = r.updated_at ?? 0;
      if (incomingTs > (local.updated_at ?? 0)) {
        state.words[idx] = { ...local, ...r };
        enqueue(state.words[idx]);
        updated++;
      } else {
        skipped++;
      }
    }
  }
  persist();
  sync();
  return { added, updated, skipped };
}

// --- Sync ---------------------------------------------------------
let syncing = false;

export async function sync() {
  if (syncing) return { skipped: "in-flight" };
  if (!navigator.onLine) return { skipped: "offline" };
  const user = await getUser();
  if (!user) return { skipped: "not-signed-in" };
  syncing = true;
  try {
    // 1) Push
    if (state.pendingOps.length > 0) {
      const batch = state.pendingOps.slice();
      const { error } = await pushUpserts(batch);
      if (error) {
        console.warn("[sync] push failed", error);
        return { error };
      }
      // 移除已成功 push 的 ops(只移那批,期間新進的留著)
      const ids = new Set(batch.map((b) => b.id));
      state.pendingOps = state.pendingOps.filter((p) => !ids.has(p.id));
    }
    // 2) Pull
    const { data, error } = await pullAll();
    if (error) {
      console.warn("[sync] pull failed", error);
      return { error };
    }
    const remote = data ?? [];
    // 以 id 合併,updated_at 大者勝
    const byId = new Map();
    for (const w of state.words) byId.set(w.id, w);
    for (const r of remote) {
      const local = byId.get(r.id);
      if (!local || (r.updated_at ?? 0) > (local.updated_at ?? 0)) {
        byId.set(r.id, r);
      }
    }
    state.words = Array.from(byId.values());
    state.lastSyncAt = Date.now();
    persist();
    return { ok: true, pulled: remote.length };
  } finally {
    syncing = false;
  }
}

export function getSyncStatus() {
  return {
    pending: state.pendingOps.length,
    online: navigator.onLine,
    lastSyncAt: state.lastSyncAt,
    syncing,
  };
}

// --- Triggers -----------------------------------------------------
let triggersInstalled = false;
export function installSyncTriggers() {
  if (triggersInstalled) return;
  triggersInstalled = true;
  window.addEventListener("online", () => sync());
  window.addEventListener("focus", () => sync());
  setInterval(() => sync(), SYNC_INTERVAL_MS);
}
