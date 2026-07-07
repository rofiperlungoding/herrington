import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { SignJWT } from 'jose';
import { composeHandler, HttpError } from './_lib/handler.ts';
import { createDrizzleClient } from './_lib/db.ts';
import { users, sessions } from '../../src/shared/db/schema.ts';
import { jsonResponse } from './_lib/json.ts';

const refreshSchema = z.object({
  refresh_token: z.string(),
});

export default composeHandler(async (req) => {
  if (req.method !== 'POST') {
    throw new HttpError(405, 'method_not_allowed', 'Method not allowed');
  }

  const body = await req.json();
  const { refresh_token } = refreshSchema.parse(body);

  const db = createDrizzleClient();
  
  // Find session
  const session = await db.select().from(sessions).where(eq(sessions.refreshToken, refresh_token)).get();
  if (!session) {
    throw new HttpError(401, 'invalid_grant', 'Invalid refresh token');
  }

  if (session.expiresAt < new Date()) {
    await db.delete(sessions).where(eq(sessions.id, session.id)).run();
    throw new HttpError(401, 'invalid_grant', 'Refresh token expired');
  }

  // Find user
  const user = await db.select().from(users).where(eq(users.id, session.userId)).get();
  if (!user) {
    throw new HttpError(401, 'invalid_grant', 'User no longer exists');
  }

  // Generate new tokens
  const newSessionId = nanoid();
  const newRefreshToken = nanoid(32);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

  // Replace old session with new session (token rotation)
  await db.transaction(async (tx) => {
    await tx.delete(sessions).where(eq(sessions.id, session.id)).run();
    await tx.insert(sessions).values({
      id: newSessionId,
      userId: user.id,
      refreshToken: newRefreshToken,
      expiresAt,
    }).run();
  });

  // Generate Access Token (JWT)
  const secret = Deno.env.get('AUTH_JWT_SECRET');
  if (!secret) {
    throw new Error('AUTH_JWT_SECRET is missing');
  }

  const accessToken = await new SignJWT({ sid: newSessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(secret));

  return jsonResponse(200, {
    session: {
      access_token: accessToken,
      refresh_token: newRefreshToken,
      expires_at: Math.floor(Date.now() / 1000) + 3600, // 1 hour
      user: {
        id: user.id,
        email: user.email,
      },
    },
  });
});
