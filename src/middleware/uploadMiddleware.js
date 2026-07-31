import multer from "multer";
import AppError from "../utils/AppError.js";

// Memory storage use kar rahe hain — file disk pe save nahi hogi,
// balki req.file.buffer mein ek Buffer object ke roop mein milegi.
// Yahi buffer hum aage Supabase Storage ko bhejenge.
const storage = multer.memoryStorage();

// File filter — sirf allowed file types accept karenge
// Ye function Multer khud call karta hai har file ke liye
const fileFilter = (req, file, cb) => {
  // Resume ke liye PDF/DOC/DOCX allowed, logo ke liye images allowed
  // Field name (fieldname) se pata chalta hai konsi file aa rahi hai
  const allowedResumeTypes = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ];
  const allowedImageTypes = ["image/jpeg", "image/png", "image/webp"];

  if (file.fieldname === "resume" && allowedResumeTypes.includes(file.mimetype)) {
    cb(null, true); // file accept karo
  } else if (file.fieldname === "logo" && allowedImageTypes.includes(file.mimetype)) {
    cb(null, true); // file accept karo
  } else {
    // Galat file type — reject karo, custom AppError ke sath
    cb(new AppError("Invalid file type. Resume ke liye PDF/DOC, logo ke liye image bhejein", 400));
  }
};

// Multer instance — memory storage + file size limit (5MB) + type filter ke sath
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB tak allowed — bade files server ko slow na karein
  fileFilter,
});

export default upload;
