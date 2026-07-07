import { z } from 'zod';
import { hash } from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { SignJWT } from 'jose';
import { composeHandler, HttpError } from './_lib/handler.ts';
import { createDrizzleClient } from './_lib/db.ts';
import { users, sessions } from '../../src/shared/db/schema.ts';
import { jsonResponse } from './_lib/json.ts';

const signUpSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export default composeHandler(async (req) => {
  if (req.method !== 'POST') {
    throw new HttpError(405, 'method_not_allowed', 'Method not allowed');
  }

  const body = await req.json();
  const { email, password } = signUpSchema.parse(body);

  const db = createDrizzleClient();
  
  // Check if user already exists
  const existingUser = await db.select().from(users).where(eq(users.email, email)).get();
  if (existingUser) {
    throw new HttpError(400, 'user_exists', 'User already exists');
  }

  const userId = nanoid();
  const passwordHash = await hash(password, 10);

  // Insert user
  await db.insert(users).values({
    id: userId,
    email,
    passwordHash,
  }).run();

  const sessionId = nanoid();
  const refreshToken = nanoid(32);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

  // Insert session
  await db.insert(sessions).values({
    id: sessionId,
    userId,
    refreshToken,
    expiresAt,
  }).run();

  // Generate Access Token (JWT)
  const secret = Deno.env.get('AUTH_JWT_SECRET');
  if (!secret) {
    throw new Error('AUTH_JWT_SECRET is missing');
  }

  const accessToken = await new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(secret));

  return jsonResponse(200, {
    session: {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: Math.floor(Date.now() / 1000) + 3600, // 1 hour
      user: {
        id: userId,
        email,
      },
    },
  });
});
