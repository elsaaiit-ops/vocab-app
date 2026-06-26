# Seed 字表

可直接餵給 app 的「**字表匯入**」tab。每個檔案都是 `[{word, meaning, example, part_of_speech}]` 結構,符合 [build spec §3](../docs/superpowers/plans/2026-06-26-vocab-pwa.md) 的 Word schema。

## 內容

| 檔名 | 字數 | 內容 |
|------|------|------|
| `toeic-900-batch1-200.json` | 200 | TOEIC 900+ 第一批:管理 / 財金 / 法律 / HR / 行銷 / 營運 / 科技 / 高階形容詞 |
| `toeic-900-batch2-200.json` | 200 | TOEIC 900+ 第二批:動作動詞 / 商務溝通 / 會議文件 / 房地產 / 製造品管 / 客服旅宿 / 副詞 / 高頻名詞 |

兩批合計 **400 字、零重複**。

## 怎麼用

### 在 app 裡匯入

1. 開 app → 確定右上是 🟢 已同步
2. 「新增」tab → 點「**字表匯入**」
3. 「**或選 .json 檔**」 → 選這裡的檔案
4. 看到「匯入完成:新增 N、已存在跳過 X、格式不合 0」即可

匯入時 app 會用 word 大小寫不敏感去重 — 重跑同一個檔不會產生重複,可以放心。

### 別台裝置也想要

直接從 GitHub raw 下載也行:
```
https://raw.githubusercontent.com/elsaaiit-ops/vocab-app/main/seed/toeic-900-batch1-200.json
https://raw.githubusercontent.com/elsaaiit-ops/vocab-app/main/seed/toeic-900-batch2-200.json
```

## 自製清單格式

最少欄位是 `word` + `meaning`(必填),其他可空:

```json
[
  { "word": "hello", "meaning": "你好" },
  { "word": "negotiate", "meaning": "協商", "example": "Let's negotiate the terms.", "part_of_speech": "v" }
]
```

匯入後一律 `box: 1`、`source: "list"`、`seen: 0`、`correct: 0`。
