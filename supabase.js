// 薄薄一層:把 Supabase JS 包成 app 用的小 API。
// 失敗時直接把 SDK 的 { data, error } 往外傳,UI 端決定怎麼顯示。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

// --- Auth ---------------------------------------------------------
export async function signUp(email, password) {
  return supabase.auth.signUp({ email, password });
}

export async function signIn(email, password) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  return supabase.auth.signOut();
}

export async function getUser() {
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

export function onAuthStateChange(cb) {
  return supabase.auth.onAuthStateChange((event, session) => cb(session?.user ?? null, event));
}

// --- Words --------------------------------------------------------
// rows: 一批要 upsert 的單字物件;欄位名與 DB 對齊(snake_case)。
// 注意:DB 表有 user_id default auth.uid(),前端不用手填,但 upsert 需要把 user_id 帶進去
// (因為 upsert 用 update + insert,update 路徑不會套用 default),所以這裡會自動補上。
export async function pushUpserts(rows) {
  const user = await getUser();
  if (!user) return { data: null, error: new Error("not signed in") };
  const stamped = rows.map((r) => ({ ...r, user_id: user.id }));
  return supabase.from("words").upsert(stamped, { onConflict: "id" });
}

export async function pullAll() {
  return supabase.from("words").select("*");
}
