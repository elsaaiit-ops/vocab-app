// 發音:優先真人錄音 (Free Dictionary API 提供的 MP3),失敗 fallback 到瀏覽器內建 TTS。
// URL 用 localStorage 快取,同一個字第二次不再打 API。
// 快取 key 用 word id — 這樣純本地、不用改 Supabase schema、不會有同步衝突。

const DICT_ENDPOINT = "https://api.dictionaryapi.dev/api/v2/entries/en/";
const CACHE_KEY = "vocab-audio-cache";

let current = null;   // 目前 HTMLAudioElement (若有)
let voice = null;     // 已挑好的英文 SpeechSynthesis voice

function pickVoice() {
  if (voice) return voice;
  if (typeof speechSynthesis === "undefined") return null;
  const voices = speechSynthesis.getVoices();
  voice = voices.find((v) => v.lang === "en-US" && v.default)
       || voices.find((v) => v.lang === "en-US")
       || voices.find((v) => v.lang.startsWith("en"))
       || null;
  return voice;
}

if (typeof speechSynthesis !== "undefined") {
  // 首次 getVoices() 通常空陣列,voiceschanged 才拿得到清單。
  speechSynthesis.addEventListener?.("voiceschanged", () => { voice = null; pickVoice(); });
  pickVoice();
}

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); }
  catch { return {}; }
}
function writeCache(c) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch {}
}

export function stop() {
  if (current) { try { current.pause(); } catch {} current = null; }
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}

function tts(text) {
  if (typeof speechSynthesis === "undefined") return false;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  u.rate = 0.9;
  const v = pickVoice();
  if (v) u.voice = v;
  speechSynthesis.speak(u);
  return true;
}

function playMp3(url) {
  return new Promise((resolve, reject) => {
    const a = new Audio(url);
    current = a;
    a.onended = () => { if (current === a) current = null; resolve(); };
    a.onerror = () => { if (current === a) current = null; reject(new Error("audio load failed")); };
    a.play().catch(reject);
  });
}

async function fetchAudioUrl(word) {
  try {
    const res = await fetch(DICT_ENDPOINT + encodeURIComponent(word));
    if (!res.ok) return null;
    const json = await res.json();
    const entry = Array.isArray(json) ? json[0] : null;
    for (const p of entry?.phonetics ?? []) {
      const u = p?.audio;
      if (typeof u === "string" && u.trim()) return u.startsWith("//") ? "https:" + u : u;
    }
    return null;
  } catch { return null; }
}

// 主 API:playWord(word, wordId?)
//   1) 若 cache 有 MP3 URL → 直接放
//   2) 否則若在線 → 打字典 API 拿 MP3,存快取,放
//   3) 都不行 → TTS
// 回傳 promise,值是 "mp3-cached" | "mp3-fetched" | "tts" | "none"
export async function playWord(word, wordId) {
  stop();
  const cache = readCache();
  let url = wordId ? cache[wordId] : null;

  if (url) {
    try { await playMp3(url); return "mp3-cached"; }
    catch { delete cache[wordId]; writeCache(cache); /* 舊 URL 壞了,清掉重抓 */ }
  }

  if (navigator.onLine) {
    url = await fetchAudioUrl(word);
    if (url) {
      if (wordId) { cache[wordId] = url; writeCache(cache); }
      try { await playMp3(url); return "mp3-fetched"; } catch {}
    }
  }

  return tts(word) ? "tts" : "none";
}
