// Service Worker:app 殼用 cache-first;Supabase / 字典 API 用 network。
// 改了任何快取資源時要把 CACHE 版本號 +1。
const CACHE = "vocab-v1";

const SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./store.js",
  "./srs.js",
  "./supabase.js",
  "./config.js",
  "./styles.css",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  // Supabase JS via esm.sh (固定版本)
  "https://esm.sh/@supabase/supabase-js@2",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => {
      // 用 addAll 任何一個失敗會整批 reject,所以改成個別 add 並吞掉錯誤
      // (例如離線安裝時 esm.sh 拿不到,不該擋住整個 SW)
      return Promise.all(
        SHELL.map((url) =>
          cache.add(url).catch((e) => console.warn("[sw] skip cache", url, e.message))
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // 只快取 GET

  const url = new URL(req.url);
  const isApi =
    url.hostname.endsWith("supabase.co") ||
    url.hostname.endsWith("supabase.in") ||
    url.hostname === "api.dictionaryapi.dev";

  if (isApi) {
    // network only;離線就自然失敗,UI 那邊由 pendingOps 處理
    event.respondWith(fetch(req).catch(() => new Response("offline", { status: 503 })));
    return;
  }

  // App shell:cache-first
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          // 把 esm.sh 的後續轉址 / dependency 也順手加入快取
          if (res.ok && (url.origin === self.location.origin || url.hostname === "esm.sh")) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});
