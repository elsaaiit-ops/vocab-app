// UI 控制器。把 store / srs 接到畫面上。
// 沒有 framework,所以全部用 createElement + 事件;每個 tab 一個 render 函式,切 tab 時清空 main 再渲染。
import {
  loadState, getWords, getAllIncludingDeleted, getWordById, findByWord,
  addWord, gradeWord, deleteWord, mergeImport,
  sync, getSyncStatus, installSyncTriggers, getSettings, setSettings,
} from "./store.js";
import { sortDue, sortWeak, levenshtein, INTERVALS } from "./srs.js";
import { onAuthStateChange, signIn, signUp, signOut, getUser } from "./supabase.js";

// =================================================================
// DOM helpers
// =================================================================
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k in el) {
      try { el[k] = v; } catch { el.setAttribute(k, v); }
    } else {
      el.setAttribute(k, v);
    }
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return el;
}

const $ = (sel) => document.querySelector(sel);
const view = () => $("#view");
function clearView() { view().innerHTML = ""; }
function mount(...nodes) {
  clearView();
  for (const n of nodes) view().appendChild(n);
}

// =================================================================
// Global state (UI)
// =================================================================
let currentTab = "dashboard";
let currentUser = null;

// =================================================================
// Auth bar + login modal
// =================================================================
function renderAuthBar() {
  const btn = $("#auth-btn");
  if (currentUser) {
    btn.textContent = `登出 (${currentUser.email})`;
    btn.onclick = async () => { await signOut(); };
  } else {
    btn.textContent = "登入";
    btn.onclick = () => renderLogin();
  }
}

function renderLogin() {
  currentTab = "login";
  highlightTab(null);
  const email = h("input", { type: "email", placeholder: "email", autocomplete: "email" });
  const pwd   = h("input", { type: "password", placeholder: "密碼(至少 6 字)", autocomplete: "current-password" });
  const pwdToggle = h("button", {
    type: "button",
    class: "pwd-toggle",
    title: "顯示/隱藏密碼",
    onclick: () => {
      const showing = pwd.type === "text";
      pwd.type = showing ? "password" : "text";
      pwdToggle.textContent = showing ? "👁" : "🙈";
    },
  }, "👁");
  const pwdWrap = h("div", { class: "pwd-wrap" }, pwd, pwdToggle);
  const msg   = h("div", { class: "muted" });

  async function go(mode) {
    msg.textContent = "處理中…";
    msg.className = "muted";
    try {
      const fn = mode === "signup" ? signUp : signIn;
      const { error } = await fn(email.value.trim(), pwd.value);
      if (error) {
        msg.textContent = `失敗:${error.message}`;
        msg.className = "toast error";
      } else {
        msg.textContent = mode === "signup" ? "註冊成功,可登入了" : "登入成功,同步中…";
        msg.className = "toast";
        if (mode === "signin") {
          // onAuthStateChange 會處理,但這裡先把 tab 切回 dashboard
          setTimeout(() => switchTab("dashboard"), 300);
        }
      }
    } catch (e) {
      msg.textContent = `錯誤:${e.message}`;
      msg.className = "toast error";
    }
  }

  mount(
    h("div", { class: "card login-card" },
      h("h2", {}, "登入 / 註冊"),
      h("p", { class: "muted" }, "用 email + 密碼。第一次請點「註冊」,之後同帳號登入即可。"),
      h("div", { class: "form-row" }, h("label", {}, "Email"), email),
      h("div", { class: "form-row" }, h("label", {}, "密碼"), pwdWrap),
      h("div", { class: "btn-row" },
        h("button", { class: "btn", onclick: () => go("signin") }, "登入"),
        h("button", { class: "btn secondary", onclick: () => go("signup") }, "註冊"),
        h("button", { class: "btn ghost", onclick: () => switchTab("dashboard") }, "稍後再說")
      ),
      msg
    )
  );
}

// =================================================================
// Sync indicator
// =================================================================
function renderSyncIndicator() {
  const el = $("#sync-indicator");
  const s = getSyncStatus();
  if (!s.online) {
    el.textContent = "⚪ 離線";
    el.title = "目前離線,寫入會在回線時自動同步";
  } else if (!currentUser) {
    el.textContent = "🔒 未登入";
    el.title = "登入後才會同步到雲端";
  } else if (s.pending > 0) {
    el.textContent = `🟡 待同步 ${s.pending}`;
    el.title = "有資料尚未上傳";
  } else if (s.syncing) {
    el.textContent = "🔄 同步中";
  } else {
    el.textContent = "🟢 已同步";
    el.title = s.lastSyncAt ? `最後同步:${new Date(s.lastSyncAt).toLocaleString()}` : "";
  }
}

// =================================================================
// Tabs
// =================================================================
const RENDERERS = {
  dashboard: renderDashboard,
  add:       renderAdd,
  words:     renderMyWords,
  practice:  renderPractice,
  backup:    renderBackup,
};

function highlightTab(name) {
  document.querySelectorAll("nav#tabs button").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === name);
  });
}

function switchTab(name) {
  currentTab = name;
  highlightTab(name);
  const fn = RENDERERS[name];
  if (fn) fn();
}

// =================================================================
// Dashboard
// =================================================================
function renderDashboard() {
  const words = getWords();
  const total = words.length;
  const due = sortDue(words).length;
  const sumSeen = words.reduce((s, w) => s + (w.seen ?? 0), 0);
  const sumCorrect = words.reduce((s, w) => s + (w.correct ?? 0), 0);
  const acc = sumSeen === 0 ? "—" : `${Math.round((sumCorrect / sumSeen) * 100)}%`;

  const boxCounts = [0, 0, 0, 0, 0];
  for (const w of words) {
    const b = Math.min(Math.max(w.box ?? 1, 1), 5);
    boxCounts[b - 1]++;
  }
  const maxBox = Math.max(1, ...boxCounts);

  mount(
    h("div", { class: "stat-grid" },
      statCard("總字數", total),
      statCard("今天 due", due),
      statCard("整體正確率", acc),
      statCard("待同步", `${getSyncStatus().pending}`)
    ),
    h("div", { class: "card" },
      h("div", { class: "section-title" }, "Box 分布"),
      ...boxCounts.map((n, i) =>
        h("div", { class: "box-bar-row" },
          h("span", {}, `box ${i + 1}`),
          h("div", { class: "box-bar" }, h("div", { style: `width:${(n / maxBox) * 100}%` })),
          h("span", { class: "muted" }, `${n}`)
        )
      ),
      h("div", { class: "muted", style: "margin-top:8px" },
        "間隔(天):" + INTERVALS.slice(1).map((d, i) => `box${i + 1}=${d}`).join(" · ")
      )
    )
  );
}

function statCard(label, num) {
  return h("div", { class: "card" },
    h("div", { class: "stat-num" }, `${num}`),
    h("div", { class: "stat-label" }, label)
  );
}

// =================================================================
// Add
// =================================================================
let addMode = "manual"; // "manual" | "paper" | "list"

function renderAdd() {
  const tabBtn = (id, label) =>
    h("button", {
      class: "btn " + (addMode === id ? "" : "secondary"),
      onclick: () => { addMode = id; renderAdd(); },
    }, label);

  const node = h("div", {},
    h("div", { class: "btn-row" },
      tabBtn("manual", "手動"),
      tabBtn("paper",  "論文(查字典)"),
      tabBtn("list",   "字表匯入")
    ),
    h("div", { id: "add-body", style: "margin-top:12px" })
  );
  mount(node);

  if (addMode === "manual") renderAddManual();
  else if (addMode === "paper") renderAddPaper();
  else renderAddList();
}

function renderAddManual(prefill = {}, banner = null) {
  const word    = h("input", { type: "text", value: prefill.word ?? "", placeholder: "e.g. ubiquitous", autocomplete: "off", autocapitalize: "off" });
  const meaning = h("input", { type: "text", value: prefill.meaning ?? "", placeholder: "中文意思 / 解釋" });
  const example = h("input", { type: "text", value: prefill.example ?? "", placeholder: "例句(可空)" });
  const pos     = h("input", { type: "text", value: prefill.part_of_speech ?? "", placeholder: "詞性(可空)" });
  const msg     = h("div");

  function submit() {
    const w = word.value.trim();
    if (!w) { msg.textContent = "word 必填"; msg.className = "toast error"; return; }
    if (!meaning.value.trim()) { msg.textContent = "meaning 必填"; msg.className = "toast error"; return; }
    const { dedupedTo } = addWord({
      word: w, meaning: meaning.value, example: example.value,
      part_of_speech: pos.value, source: prefill._source ?? "manual",
    });
    if (dedupedTo) { msg.textContent = `「${w}」已存在,跳過`; msg.className = "toast warn"; }
    else { msg.textContent = `已加入「${w}」`; msg.className = "toast"; word.value = ""; meaning.value = ""; example.value = ""; pos.value = ""; }
  }

  const body = $("#add-body");
  body.innerHTML = "";
  if (banner) body.appendChild(banner);
  body.appendChild(h("div", { class: "card" },
    h("div", { class: "form-row" }, h("label", {}, "Word"),    word),
    h("div", { class: "form-row" }, h("label", {}, "Meaning"), meaning),
    h("div", { class: "form-row" }, h("label", {}, "Example"), example),
    h("div", { class: "form-row" }, h("label", {}, "Part of speech"), pos),
    h("div", { class: "btn-row" }, h("button", { class: "btn", onclick: submit }, "新增")),
    msg
  ));
  word.focus();
}

function renderAddPaper() {
  const word = h("input", { type: "text", placeholder: "輸入一個英文字", autocapitalize: "off", autocomplete: "off" });
  const status = h("div", { class: "muted" });
  const previewWrap = h("div");

  async function lookup() {
    const w = word.value.trim();
    if (!w) return;
    status.textContent = "查詢中…";
    status.className = "muted";
    previewWrap.innerHTML = "";
    try {
      const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const entry = Array.isArray(json) ? json[0] : null;
      if (!entry) throw new Error("無資料");
      const meaningObj = entry.meanings?.[0];
      const defObj = meaningObj?.definitions?.[0];
      const prefill = {
        word: entry.word ?? w,
        part_of_speech: meaningObj?.partOfSpeech ?? "",
        meaning: defObj?.definition ?? "",
        example: defObj?.example ?? "",
        _source: "paper",
      };
      status.textContent = "查到了,確認後存檔:";
      previewWrap.innerHTML = "";
      // 重用 manual 表單呈現可編輯預覽
      addMode = "manual";
      renderAdd();
      renderAddManual(prefill, h("div", { class: "toast" }, `已自動帶入「${prefill.word}」的字典資料,可編輯後存檔`));
    } catch (e) {
      const banner = h("div", { class: "toast warn" },
        `API 失敗:${e.message}。改用手動填入,word 已先帶入。`
      );
      addMode = "manual";
      renderAdd();
      renderAddManual({ word: w, _source: "paper" }, banner);
    }
  }

  const body = $("#add-body");
  body.innerHTML = "";
  body.appendChild(h("div", { class: "card" },
    h("div", { class: "form-row" },
      h("label", {}, "英文字"),
      word,
    ),
    h("div", { class: "btn-row" },
      h("button", { class: "btn", onclick: lookup }, "查字典"),
    ),
    h("div", { class: "muted", style: "margin-top:6px" },
      "資料來源:Free Dictionary API (api.dictionaryapi.dev)。失敗會 fallback 到手動。"
    ),
    status,
    previewWrap
  ));
  word.focus();
  word.addEventListener("keydown", (e) => { if (e.key === "Enter") lookup(); });
}

const STARTER_LIST = [
  { word: "ubiquitous",    meaning: "無所不在的",       example: "Smartphones are ubiquitous nowadays." },
  { word: "ephemeral",     meaning: "短暫的、轉瞬即逝", example: "Fame is often ephemeral." },
  { word: "pragmatic",     meaning: "務實的",           example: "She took a pragmatic approach to the problem." },
  { word: "meticulous",    meaning: "一絲不苟的",       example: "He is meticulous about details." },
  { word: "candid",        meaning: "坦率的",           example: "I appreciate your candid feedback." },
  { word: "resilient",     meaning: "有韌性的",         example: "Children are remarkably resilient." },
  { word: "ambiguous",     meaning: "模稜兩可的",       example: "The instructions were ambiguous." },
  { word: "diligent",      meaning: "勤奮的",           example: "A diligent student keeps studying." },
  { word: "scrutinize",    meaning: "仔細檢查",         example: "Auditors will scrutinize the report." },
  { word: "alleviate",     meaning: "減輕、緩和",       example: "Aspirin can alleviate the pain." },
  { word: "redundant",     meaning: "多餘的",           example: "Avoid redundant code." },
  { word: "consensus",     meaning: "共識",             example: "We reached a consensus after the debate." },
];

function renderAddList() {
  const textarea = h("textarea", { placeholder: '[{"word":"hello","meaning":"你好","example":"..."}]' });
  const file = h("input", { type: "file", accept: ".json,application/json" });
  const msg = h("div");

  function doImport(rows) {
    if (!Array.isArray(rows)) {
      msg.textContent = "JSON 必須是陣列"; msg.className = "toast error"; return;
    }
    let added = 0, dup = 0, bad = 0;
    for (const r of rows) {
      if (!r || !r.word) { bad++; continue; }
      const { dedupedTo } = addWord({
        word: r.word, meaning: r.meaning ?? "", example: r.example ?? "",
        part_of_speech: r.part_of_speech ?? "", source: "list",
      });
      if (dedupedTo) dup++; else added++;
    }
    msg.textContent = `匯入完成:新增 ${added}、已存在跳過 ${dup}、格式不合 ${bad}`;
    msg.className = "toast";
  }

  file.onchange = async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      doImport(JSON.parse(text));
    } catch (e) {
      msg.textContent = `讀檔失敗:${e.message}`; msg.className = "toast error";
    }
  };

  const body = $("#add-body");
  body.innerHTML = "";
  body.appendChild(h("div", { class: "card" },
    h("div", { class: "form-row" },
      h("label", {}, "貼上 JSON 陣列"),
      textarea
    ),
    h("div", { class: "btn-row" },
      h("button", { class: "btn", onclick: () => {
        try { doImport(JSON.parse(textarea.value)); }
        catch (e) { msg.textContent = `解析失敗:${e.message}`; msg.className = "toast error"; }
      } }, "匯入貼上的內容"),
      h("button", { class: "btn secondary", onclick: () => { textarea.value = JSON.stringify(STARTER_LIST, null, 2); } }, "填入範例(12 字)"),
    ),
    h("div", { class: "form-row", style: "margin-top:14px" },
      h("label", {}, "或選 .json 檔"),
      file
    ),
    msg
  ));
}

// =================================================================
// My words
// =================================================================
function renderMyWords() {
  const words = getWords().sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0));
  if (words.length === 0) {
    mount(h("div", { class: "card" }, h("p", { class: "muted" }, "還沒有單字。到「新增」開始吧。")));
    return;
  }
  const list = h("div", { class: "card" },
    h("div", { class: "section-title" }, `我的單字(${words.length})`),
    ...words.map((w) =>
      h("div", { class: "word-row" },
        h("div", {},
          h("div", { class: "w-main" }, w.word + (w.part_of_speech ? `  (${w.part_of_speech})` : "")),
          h("div", { class: "w-meta" }, `${w.meaning || "—"} · box ${w.box} · ${w.correct}/${w.seen} · ${w.source}`)
        ),
        h("button", {
          class: "btn ghost",
          onclick: () => {
            if (confirm(`刪除「${w.word}」?`)) deleteWord(w.id);
          },
        }, "🗑")
      )
    )
  );
  mount(list);
}

// =================================================================
// Practice
// =================================================================
let practiceMode = "card";       // "card" | "spell"
let practiceSource = "due";      // "due" | "weak"
let practiceQueue = [];
let practiceTotalDue = 0;        // 「總共符合條件的字」,顯示用
let practiceIdx = 0;
let practiceFlipped = false;

const BATCH_OPTIONS = [
  { v: 10,  label: "每輪 10 字" },
  { v: 20,  label: "每輪 20 字" },
  { v: 50,  label: "每輪 50 字" },
  { v: 100, label: "每輪 100 字" },
  { v: 0,   label: "全部" },
];

const SOURCE_OPTIONS = [
  { v: "due",  label: "今天 due" },
  { v: "weak", label: "我不會的字" },
];

function getBatchSize() {
  const n = getSettings().practiceBatchSize;
  return (typeof n === "number" && n >= 0) ? n : 20;
}

function buildPracticeQueue() {
  const all = getWords();
  const full = practiceSource === "weak" ? sortWeak(all) : sortDue(all);
  practiceTotalDue = full.length;
  const size = getBatchSize();
  practiceQueue = size > 0 ? full.slice(0, size) : full;
  practiceIdx = 0;
  practiceFlipped = false;
}

function renderPractice() {
  const modeBtn = (id, label) =>
    h("button", {
      class: "btn " + (practiceMode === id ? "" : "secondary"),
      onclick: () => {
        practiceMode = id;
        buildPracticeQueue();
        renderPractice();
      },
    }, label);

  const sizeSelect = h("select", {
    onchange: (e) => {
      setSettings({ practiceBatchSize: Number(e.target.value) });
      buildPracticeQueue();
      renderPractice();
    },
  }, ...BATCH_OPTIONS.map((o) =>
    h("option", { value: o.v, selected: o.v === getBatchSize() }, o.label)
  ));

  const sourceSelect = h("select", {
    onchange: (e) => {
      practiceSource = e.target.value;
      buildPracticeQueue();
      renderPractice();
    },
  }, ...SOURCE_OPTIONS.map((o) =>
    h("option", { value: o.v, selected: o.v === practiceSource }, o.label)
  ));

  const header = h("div", { class: "btn-row" },
    modeBtn("card", "字卡"),
    modeBtn("spell", "拼寫"),
    sourceSelect,
    sizeSelect,
    h("button", { class: "btn ghost", onclick: () => { buildPracticeQueue(); renderPractice(); } }, "🔄 重抽")
  );

  if (practiceQueue.length === 0) buildPracticeQueue();

  if (practiceQueue.length === 0) {
    const empty = practiceSource === "weak"
      ? "目前還沒有累積到「我不會的字」 — 多練幾次,box 1/2 的或正確率 < 50% 的會被挑出來。"
      : "今天沒有要複習的字 🎉";
    mount(header, h("div", { class: "card" }, h("p", {}, empty)));
    return;
  }

  if (practiceIdx >= practiceQueue.length) {
    const remaining = Math.max(0, practiceTotalDue - practiceQueue.length);
    const remainLabel = practiceSource === "weak"
      ? `「我不會的字」還有 ${remaining} 個沒練,要繼續嗎?`
      : `今天還有 ${remaining} 個字 due,要繼續嗎?`;
    mount(header,
      h("div", { class: "card" },
        h("p", {}, `完成 ${practiceQueue.length} 題 🎉`),
        remaining > 0 ? h("p", { class: "muted" }, remainLabel) : null,
        h("button", { class: "btn", onclick: () => { buildPracticeQueue(); renderPractice(); } }, "再來一輪")
      )
    );
    return;
  }

  const w = practiceQueue[practiceIdx];
  const totalNoun = practiceSource === "weak" ? "不會" : "due";
  const totalLabel = practiceTotalDue > practiceQueue.length
    ? `${practiceIdx + 1} / ${practiceQueue.length}  ·  本輪共 ${practiceQueue.length} / ${practiceTotalDue} ${totalNoun}`
    : `${practiceIdx + 1} / ${practiceQueue.length}`;
  const progress = h("div", { class: "progress" }, totalLabel);

  if (practiceMode === "card") {
    mount(header, progress, renderFlashcard(w));
  } else {
    mount(header, progress, renderSpelling(w));
  }
}

function advance() {
  practiceIdx++;
  practiceFlipped = false;
  renderPractice();
}

function gradeAndAdvance(id, correct) {
  gradeWord(id, correct);
  advance();
}

function renderFlashcard(w) {
  const card = h("div", { class: "flashcard" });
  function paint() {
    card.innerHTML = "";
    if (!practiceFlipped) {
      card.appendChild(h("div", { class: "word" }, w.word));
      card.appendChild(h("div", { class: "hint" }, "點卡片翻面"));
    } else {
      card.appendChild(h("div", { class: "meaning" }, w.meaning || "(沒有 meaning)"));
      if (w.part_of_speech) card.appendChild(h("div", { class: "hint" }, w.part_of_speech));
      if (w.example) card.appendChild(h("div", { class: "example" }, w.example));
    }
  }
  paint();
  card.onclick = () => { practiceFlipped = !practiceFlipped; paint(); };
  const buttons = h("div", { class: "grade-row" },
    h("button", { class: "btn no",  onclick: () => gradeAndAdvance(w.id, false) }, "我不會 ✗"),
    h("button", { class: "btn yes", onclick: () => gradeAndAdvance(w.id, true)  }, "我會 ✓"),
  );
  return h("div", {}, card, buttons);
}

function renderSpelling(w) {
  const input = h("input", { type: "text", placeholder: "打出英文字", autocapitalize: "off", autocomplete: "off", autocorrect: "off", spellcheck: false });
  const result = h("div");

  function judge() {
    const ans = (input.value ?? "").trim().toLowerCase();
    const target = (w.word ?? "").trim().toLowerCase();
    if (!ans) return;
    if (ans === target) {
      result.textContent = `✓ 答對:${w.word}`;
      result.className = "toast";
      setTimeout(() => gradeAndAdvance(w.id, true), 600);
      return;
    }
    const dist = levenshtein(ans, target);
    if (dist <= 1 && getSettings().typoTolerance) {
      result.innerHTML = `🟡 差一點點(Levenshtein=1)。正確拼法:<b>${w.word}</b>`;
      result.className = "toast warn";
    } else {
      result.innerHTML = `✗ 錯了。正確拼法:<b>${w.word}</b>`;
      result.className = "toast error";
    }
    setTimeout(() => gradeAndAdvance(w.id, false), 1200);
  }

  input.addEventListener("keydown", (e) => { if (e.key === "Enter") judge(); });
  setTimeout(() => input.focus(), 50);

  return h("div", { class: "card" },
    h("div", { class: "spelling-prompt" },
      h("div", { class: "meaning" }, w.meaning || "(沒有 meaning)"),
      w.part_of_speech ? h("div", { class: "pos" }, `(${w.part_of_speech})`) : null,
      w.example ? h("div", { class: "muted", style: "margin-top:6px" }, "例句提示:" + w.example.replace(new RegExp(w.word, "ig"), "____")) : null,
    ),
    h("div", { class: "form-row" }, h("label", {}, "你打的"), input),
    h("div", { class: "btn-row" },
      h("button", { class: "btn", onclick: judge }, "提交"),
      h("button", { class: "btn secondary", onclick: () => gradeAndAdvance(w.id, false) }, "跳過(算錯)"),
    ),
    result
  );
}

// =================================================================
// Backup
// =================================================================
function renderBackup() {
  const fileInput = h("input", { type: "file", accept: ".json,application/json" });
  const msg = h("div");

  function doExport() {
    const blob = new Blob([JSON.stringify(getAllIncludingDeleted(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const yyyymmdd = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const a = h("a", { href: url, download: `vocab-backup-${yyyymmdd}.json` });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    msg.textContent = `已匯出 ${getAllIncludingDeleted().length} 筆(含軟刪除)`;
    msg.className = "toast";
  }

  fileInput.onchange = async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      const rows = JSON.parse(text);
      if (!Array.isArray(rows)) throw new Error("JSON 不是陣列");
      if (!confirm(`即將匯入 ${rows.length} 筆;會與目前資料以 updated_at 合併。繼續?`)) return;
      const r = mergeImport(rows);
      msg.textContent = `匯入完成:新增 ${r.added}、更新 ${r.updated}、略過 ${r.skipped}`;
      msg.className = "toast";
    } catch (e) {
      msg.textContent = `匯入失敗:${e.message}`;
      msg.className = "toast error";
    }
  };

  mount(
    h("div", { class: "card" },
      h("div", { class: "section-title" }, "匯出"),
      h("p", { class: "muted" }, "下載完整資料(含已軟刪除的字,以便還原時保留刪除狀態)。"),
      h("div", { class: "btn-row" }, h("button", { class: "btn", onclick: doExport }, "下載 JSON")),
    ),
    h("div", { class: "card" },
      h("div", { class: "section-title" }, "匯入"),
      h("p", { class: "muted" }, "選 .json 檔。會以 updated_at 較新者勝合併,並進入同步佇列。"),
      fileInput,
      msg,
    ),
    h("div", { class: "card" },
      h("div", { class: "section-title" }, "拼寫容錯"),
      h("label", { style: "display:flex; gap:8px; align-items:center" },
        (() => {
          const cb = h("input", { type: "checkbox" });
          cb.checked = !!getSettings().typoTolerance;
          cb.onchange = () => setSettings({ typoTolerance: cb.checked });
          return cb;
        })(),
        "拼寫模式允許 Levenshtein ≤ 1 的「差一點點」提示"
      )
    )
  );
}

// =================================================================
// Init
// =================================================================
function bindTabClicks() {
  document.querySelectorAll("nav#tabs button").forEach((b) => {
    b.addEventListener("click", () => switchTab(b.dataset.tab));
  });
}

function refreshAll() {
  renderSyncIndicator();
  if (currentTab && currentTab !== "login" && RENDERERS[currentTab]) {
    RENDERERS[currentTab]();
  }
}

async function init() {
  loadState();
  bindTabClicks();
  installSyncTriggers();

  // 先試一下 user(可能 session 已持久化)
  currentUser = await getUser();
  renderAuthBar();

  // Auth 變化監聽:同步 + 重繪
  onAuthStateChange((user) => {
    currentUser = user;
    renderAuthBar();
    if (user) sync().then(refreshAll);
    refreshAll();
  });

  // 全域事件
  window.addEventListener("vocab:changed", refreshAll);
  window.addEventListener("online", refreshAll);
  window.addEventListener("offline", refreshAll);
  setInterval(renderSyncIndicator, 2000);

  switchTab("dashboard");

  // 開 app 後拉一次資料
  sync().then(refreshAll);
}

init();
