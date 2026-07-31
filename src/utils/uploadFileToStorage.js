import { supabase } from "../config/supabaseClient.js";
import AppError from "./AppError.js";

// Reusable function — kisi bhi bucket mein file buffer upload karke public URL return karta hai
// Isse resume aur logo dono ke liye same function use hoga, sirf bucketName alag denge
export const uploadFileToStorage = async (file, bucketName) => {
  // Unique file name banate hain — Date.now() se collision (do users same naam ki file upload karein) avoid hota hai
  const fileExt = file.originalname.split(".").pop(); // extension nikal rahe hain, jaise "pdf" ya "png"
  const fileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}.${fileExt}`;

  // Supabase Storage ko buffer directly bhej rahe hain — disk pe kuch save nahi kar rahe
  const { error: uploadError } = await supabase.storage
    .from(bucketName)
    .upload(fileName, file.buffer, {
      contentType: file.mimetype, // taake browser file ko sahi type se serve kare
      upsert: false, // same naam ki file dobara overwrite na ho (waise unique naam se ye case aayega hi nahi)
    });

  if (uploadError) {
    throw new AppError(`File upload fail ho gaya: ${uploadError.message}`, 500);
  }

  // Upload hone ke baad public URL nikal rahe hain — yahi URL DB mein save karenge
  const { data: publicUrlData } = supabase.storage.from(bucketName).getPublicUrl(fileName);

  return publicUrlData.publicUrl;
};
