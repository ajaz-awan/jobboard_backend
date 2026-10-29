import { Notification } from "../models/index.js";
export async function notify(userId, kind, title, message, resourceType, resourceId, dedupeKey) {
  try { await Notification.create({ user_id: userId, kind, title, message, resource_type: resourceType, resource_id: resourceId, dedupe_key: dedupeKey }); }
  catch (error) { if (error.code !== 11000) console.error(JSON.stringify({ event: "notification_write_failed", kind })); }
}
