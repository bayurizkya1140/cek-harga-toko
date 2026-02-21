import { createClient } from '@supabase/supabase-js';

// Menggunakan URL & Key yang SAMA dengan versi desktop
export const supabaseUrl = 'https://azkqgjcbjnbrmwjxcbjr.supabase.co';
export const supabaseKey = 'sb_publishable_q0qFX5JeehF9Pbu5na-ZaA_grcmfhWY';

const supabase = createClient(supabaseUrl, supabaseKey);

export default supabase;
