import { eq } from 'drizzle-orm';
import { composeHandler, HttpError } from './_lib/handler.ts';
import { createDrizzleClient } from './_lib/db.ts';
import { sessions } from '../../src/shared/db/schema.ts';
import { requireAuth } from './_lib/auth.ts';
import { jsonResponse } from './_lib/json.ts';

export default composeHandler(async (req) => {
  if (req.method !== 'POST') {
    throw new HttpError(405, 'method_not_allowed', 'Method not allowed');
  }

  const auth = await requireAuth(req);
  const db = createDrizzleClient();
  
  if (auth.sessionId) {
    await db.delete(sessions).where(eq(sessions.id, auth.sessionId)).run();
  } else {
    // If somehow we don't have a session ID, try deleting all sessions for user
    // or just ignore. We'll delete all sessions to be safe.
    await db.delete(sessions).where(eq(sessions.userId, auth.userId)).run();
  }

  return jsonResponse(200, { success: true });
});
