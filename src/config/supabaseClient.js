// src/config/supabaseClient.js
// Yeh file Supabase se connection banati hai — poori app isi client ko import karegi

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // backend mein service role key use karte hain (admin-level access)

if (!supabaseUrl || !supabaseKey) {
  // Agar .env sahi se set nahi hai to server start hote hi pata chal jaye
  throw new Error(
    "Supabase URL ya Service Role Key .env file mein missing hai. .env.example dekho."
  );
}

// Ye client poore backend mein database queries aur storage (file upload) ke liye use hoga
export const supabase = createClient(supabaseUrl, supabaseKey);
