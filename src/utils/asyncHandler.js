// src/utils/asyncHandler.js
// Ye function har async controller ko "wrap" kar deta hai
// Andar agar koi error aaye (await wali kisi line mein), to automatically next(err) ko call kar dega
// Isse har controller mein try/catch likhne ki zaroorat khatam ho jati hai

export const asyncHandler = (fn) => {
  return (req, res, next) => {
    // fn() ek Promise return karta hai (kyunke controller async hai)
    // .catch(next) matlab: agar Promise reject ho (error aaye), to Express ke error handler ko bhej do
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
