import { supabase } from "../config/supabaseClient.js";
import AppError from "../utils/AppError.js";
import {asyncHandler} from "../utils/asyncHandler.js";
import { uploadFileToStorage } from "../utils/uploadFileToStorage.js";

// ==========================================================
// EMPLOYER APNA COMPANY LOGO UPLOAD/UPDATE KARE
// PATCH /api/users/me/logo
// ==========================================================
export const uploadLogo = asyncHandler(async (req, res, next) => {
  // Multer ne file ko req.file mein daala hoga (fieldname "logo" route mein set hai)
  if (!req.file) {
    return next(new AppError("Logo file required hai (field name: 'logo')", 400));
  }

  // "logos" bucket mein upload karo — same reusable function jo resume ke liye bhi use hua
  const logo_url = await uploadFileToStorage(req.file, "logos");

  // req.user.id se apna hi record update ho raha hai — koi aur ka logo change nahi ho sakta
  const { data: updatedUser, error } = await supabase
    .from("users")
    .update({ logo_url })
    .eq("id", req.user.id)
    .select("id, name, email, company_name, logo_url")
    .single();

  if (error) {
    return next(new AppError(error.message, 500));
  }

  res.status(200).json({
    success: true,
    message: "Logo successfully update ho gaya",
    data: updatedUser,
  });
});
