import { AuditLog } from "../models/index.js";
export async function auditedAction(req, action, targetId, details, work) {
  // Failure to create an audit attempt prevents the administrative mutation.
  const audit = await AuditLog.create({ actor_id: req.user.id, request_id: req.id, action, target_id: targetId, details });
  let result;
  try { result = await work(audit.id); }
  catch (error) {
    try { await AuditLog.updateOne({ _id: audit.id }, { $set: { outcome: "failed" } }); } catch { console.error(JSON.stringify({ event: "audit_completion_pending", auditId: audit.id })); }
    throw error;
  }
  try { await AuditLog.updateOne({ _id: audit.id }, { $set: { outcome: "completed" } }); }
  catch { console.error(JSON.stringify({ event: "audit_completion_pending", auditId: audit.id })); }
  return result;
}
