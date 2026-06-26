// Supabase 連線設定。anon key 公開沒關係 — RLS 會擋住別人的資料。
// 拿到值的地方:Supabase project → Settings → API
export const SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";
export const SUPABASE_ANON_KEY = "YOUR-ANON-PUBLIC-KEY";

if (SUPABASE_URL.includes("YOUR-PROJECT") || SUPABASE_ANON_KEY.includes("YOUR-ANON")) {
  console.warn(
    "[config] SUPABASE_URL / SUPABASE_ANON_KEY 還沒填。請編輯 config.js 後重新整理。"
  );
}
