/* =============================================
   supabase-client.js — 共通接続設定
   ============================================= */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabaseUrl = 'https://epnxlbhrivagtjwxhddt.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVwbnhsYmhyaXZhZ3Rqd3hoZGR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2NzgyMTAsImV4cCI6MjA4ODI1NDIxMH0.bfK-Ts34zvAXLXqEOanUG-UTYM3zuTjX2BjhAaCmkxk';

export const supabase = createClient(supabaseUrl, supabaseKey);

export async function requireAuth() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    window.location.href = 'login.html';
    return null;
  }
  return user;
}