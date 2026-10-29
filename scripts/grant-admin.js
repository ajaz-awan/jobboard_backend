import { z } from "zod";
import { connectDatabase, closeDatabase } from "../src/config/database.js";
import { User } from "../src/models/index.js";
import { revokeAllSessions } from "../src/services/sessions.js";
const at = process.argv.indexOf("--email");
const email = z.email().safeParse(at >= 0 ? process.argv[at + 1]?.trim().toLowerCase() : "");
if (!email.success) { console.error("Usage: npm run admin:grant -- --email verified-owner@example.com"); process.exit(1); }
try {
  await connectDatabase();
  const user = await User.findOne({ email: email.data });
  if (!user || !user.email_verified_at || user.status === "suspended") throw new Error("A verified active account is required");
  if (user.role === "admin") console.log("Account already has administrator access.");
  else {
    await User.updateOne({ _id: user.id }, { $set: { role: "admin" }, $inc: { auth_version: 1, __v: 1 } });
    await revokeAllSessions(user.id);
    console.log("Administrator access granted. Log in again. Keep this database operation restricted to trusted operators.");
  }
} catch { console.error("Administrator grant failed. Check the account, verification and database configuration."); process.exitCode = 1; }
finally { await closeDatabase(); }
