# 單字練習 PWA

電腦新增單字、手機通勤時練習,資料跨裝置同步,離線也能練。
純前端(無 build step)+ Supabase 後端 + GitHub Pages 部署。

---

## 一、Supabase 設定(只做一次,大約 5 分鐘)

> 這幾步必須**你自己**做,Claude / Code 無法代你登入 Supabase。

### 1. 建一個免費 project

到 [supabase.com](https://supabase.com) 註冊,點 **New project** → 取名(例如 `vocab`)→ 選最近區域(東京 / 新加坡)。建好等待初始化完成。

### 2. 建表 + 開 Row-Level Security

左側 **SQL Editor** → 新增 query → 貼下面這段 → 按 **Run**。

```sql
create table public.words (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  word text not null,
  meaning text,
  example text,
  part_of_speech text,
  source text,                 -- 'manual' | 'paper' | 'list'
  box int not null default 1,  -- 1~5
  last_reviewed bigint,        -- epoch ms,可為 null
  seen int not null default 0,
  correct int not null default 0,
  deleted boolean not null default false,
  updated_at bigint not null
);

alter table public.words enable row level security;

create policy "own rows - select" on public.words
  for select using (auth.uid() = user_id);
create policy "own rows - insert" on public.words
  for insert with check (auth.uid() = user_id);
create policy "own rows - update" on public.words
  for update using (auth.uid() = user_id);
create policy "own rows - delete" on public.words
  for delete using (auth.uid() = user_id);
```

### 3. 開啟 email 登入,關掉 confirm

左側 **Authentication → Providers → Email** → 確認 *Enable Email provider* 開著;**Confirm email** 關掉(單人用,不需信箱驗證)。

### 4. 拿 URL 與 anon key

左側 **Project Settings → API**:

- 複製 **Project URL**
- 複製 **anon public key**

打開檔案 `config.js`,把佔位字串換掉:

```js
export const SUPABASE_URL = "https://xxxxxx.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOi...";   // anon public,可公開
```

> anon key 公開沒關係,Row-Level Security policy 會擋住別的使用者的資料。

### 5. 第一次開 app → 註冊一個帳號

把專案推上 GitHub Pages(下面 §二)後,打開網址 → 右上 **登入** → **註冊** → 輸入 email + 密碼。手機後續登入用同一組帳密,session 會持久化,重開不用再登。

---

## 二、部署到 GitHub Pages

1. 在 GitHub 新建一個 repo(例如 `vocab-app`),public 或 private 都可以(Pages 兩種都支援)。
2. 把這個資料夾推上去:
   ```bash
   git init
   git add .
   git commit -m "initial commit"
   git branch -M main
   git remote add origin https://github.com/<你的帳號>/vocab-app.git
   git push -u origin main
   ```
3. GitHub repo → **Settings → Pages** → **Source:** *Deploy from a branch* → **Branch:** `main` / **Folder:** `/ (root)` → **Save**。
4. 約一分鐘後,網址會是 `https://<你的帳號>.github.io/vocab-app/`(HTTPS,PWA 必需)。
5. 手機打開該網址 → Chrome 三點選單 → **加入主畫面** / Safari 分享 → **加到主畫面**。

> 改了 `config.js` 或任何檔案後 `git push` 就會自動重新部署。
> 改了會快取的檔案,記得把 `sw.js` 裡的 `const CACHE = "vocab-v1"` 版本號 +1,使用者下次開 app 才會更新。

---

## 三、用法速覽

| Tab | 做什麼 |
|-----|--------|
| 儀表板 | 總字數、今天 due、整體正確率、box 分布 |
| 新增 | 三種模式:手動 / 論文(查字典 API,失敗 fallback 手動)/ 字表匯入(JSON 陣列) |
| 我的單字 | 列出全部,可軟刪除 |
| 練習 | 字卡(翻面 → 我會 / 我不會)或拼寫(打字判 trim+大小寫;`typoTolerance` 開時 Levenshtein ≤ 1 提示「差一點點」) |
| 備份 | 匯出 / 匯入 `.json`(備份含軟刪除狀態) |

右上角 sync 指示器:

- 🟢 已同步
- 🟡 待同步 *n*:有資料還沒上雲(可能是離線或同步剛失敗)
- ⚪ 離線
- 🔒 未登入(本地仍可用,但不會雲端同步)

---

## 四、Leitner SRS

| box | 下次出現間隔(天) |
|-----|-------------------|
| 1   | 0(現在就要練) |
| 2   | 1 |
| 3   | 3 |
| 4   | 7 |
| 5   | 14 |

新字一律 box 1。答對 → box +1(上限 5);答錯 → 回到 box 1。

---

## 五、同步邏輯

- 本地優先:讀寫都先打 `localStorage`,UI 立刻反映。
- 任何寫入(新增 / 答題 / 軟刪除)→ 整筆放進 `pendingOps`、`updated_at = Date.now()`。
- `sync()` 流程:**Push**(upsert pendingOps)→ **Pull**(select * from words)→ 以 id 合併,同 id 取 `updated_at` 大者勝。
- 觸發時機:app 載入 + `window.online` + `window.focus` + 寫入後 + 每 30 秒。
- 刪除一律走 `deleted = true` 的軟刪除(避免「離線刪、回線又 pull 回來」)。

---

## 六、已知限制

- **單一使用者**:衝突解決用 last-write-wins。兩裝置同時離線編輯同一筆,後同步的會蓋過先同步的。
- **Confirm email 關掉**是為了單人 setup 方便。若要分享給別人用,記得重新打開。
- Free Dictionary API 沒有保證 SLA,查不到請手動補(已有 fallback)。
- 第一次安裝 PWA 後,改了任何前端檔案需要 bump `sw.js` 的 `CACHE` 版本號才會生效。

---

## 七、本機跑

```bash
# Python 3 內建 server
python -m http.server 8000
# 然後開 http://localhost:8000/
```

或用任何靜態 server。**不要直接用 `file://` 打開** — Service Worker / ES modules 都需要 HTTP/HTTPS。

---

## 八、檔案結構

```
vocab-app/
├── index.html         # 殼 + tab nav + auth bar
├── app.js             # UI 控制器(tabs / login / 三 tab 渲染)
├── store.js           # localStorage cache + pendingOps + sync()
├── srs.js             # Leitner intervals / 出題排序 / Levenshtein
├── supabase.js        # Supabase client + auth + DB wrappers
├── config.js          # SUPABASE_URL / SUPABASE_ANON_KEY
├── styles.css         # mobile-first 樣式
├── sw.js              # Service Worker
├── manifest.json
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
└── README.md
```
