// Supabase 連線設定。anon key 公開沒關係 — RLS 會擋住別人的資料。
// 拿到值的地方:Supabase project → Settings → API
export const SUPABASE_URL = "https://wnhikjxhzpeiufxtpacw.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InduaGlranhoenBlaXVmeHRwYWN3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0NDI2OTAsImV4cCI6MjA5ODAxODY5MH0.MQLz88kDZxfbVPZCUEa5nANs0eFJv0p813ZYZg-6nVM";

if (SUPABASE_URL.includes("YOUR-PROJECT") || SUPABASE_ANON_KEY.includes("YOUR-ANON")) {
  console.warn(
    "[config] SUPABASE_URL / SUPABASE_ANON_KEY 還沒填。請編輯 config.js 後重新整理。"
  );
}
