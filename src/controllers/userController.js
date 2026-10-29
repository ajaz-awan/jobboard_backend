import { User } from "../models/index.js";
import AppError from "../utils/AppError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { storeFile, removeStoredFile } from "../utils/fileStorage.js";
export const getMe = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) throw new AppError("Account is unavailable", 401);
  res.json({ success: true, data: user });
});
export const updateMe = asyncHandler(async (req, res) => {
  if (req.body.company_name !== undefined && req.user.role !== "employer") throw new AppError("Company name is only available to employers", 403);
  const user = await User.findByIdAndUpdate(req.user.id, { $set: req.body }, { returnDocument: "after", runValidators: true });
  if (!user) throw new AppError("Account is unavailable", 401);
  res.json({ success: true, data: user });
});
export const uploadLogo = asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError("Logo file is required", 400);
  const user = await User.findById(req.user.id);
  if (!user) throw new AppError("Account is unavailable", 401);
  const oldUrl = user.logo_url;
  const file = await storeFile(req.file, "logos", req.user.id);
  try { user.logo_url = file.url; await user.save(); }
  catch (error) { await removeStoredFile("logos", file.key); throw error; }
  const prefix = "/api/files/logos/";
  if (oldUrl?.startsWith(prefix)) await removeStoredFile("logos", oldUrl.slice(prefix.length));
  res.json({ success: true, data: user });
});
