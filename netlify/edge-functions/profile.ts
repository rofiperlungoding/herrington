import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { composeHandler, HttpError } from './_lib/handler.ts';
import { requireAuth, type AuthContext } from './_lib/auth.ts';
import { createDrizzleClient } from './_lib/db.ts';
import { jsonResponse } from './_lib/json.ts';
import { userProfiles } from '../../src/shared/db/schema.ts';

/**
 * User profile / preferences edge function.
 *
 *   GET   /api/profile   → return profile row (creates default if missing)
 *   PATCH /api/profile   → partial update (any subset of fields)
 *
 * The profile row is the single source of truth for personalization
 * (preferred name in greetings, accent color, dashboard tile toggles,
 * etc). A row is created on first GET/PATCH so downstream code can
 * always assume one exists.
 */

const PatchBody = z.object({
  displayName: z.string().trim().max(80).nullable().optional(),
  preferredName: z.string().trim().max(40).nullable().optional(),
  headline: z.string().trim().max(160).nullable().optional(),
  avatarEmoji: z.string().trim().max(8).nullable().optional(),
  avatarColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
  locationLabel: z.string().trim().max(80).nullable().optional(),
  focusAreas: z.string().trim().max(200).nullable().optional(),
  accent: z
    .enum(['default', 'blue', 'green', 'amber', 'rose', 'violet', 'mono'])
    .optional(),
  dateFormat: z.enum(['long', 'short', 'iso']).optional(),
  showMarkets: z.boolean().optional(),
  showWeather: z.boolean().optional(),
});

interface ProfileRow {
  userId: string;
  displayName: string | null;
  preferredName: string | null;
  headline: string | null;
  avatarEmoji: string | null;
  avatarColor: string | null;
  locationLabel: string | null;
  focusAreas: string | null;
  accent: string;
  dateFormat: string;
  showMarkets: boolean;
  showWeather: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function profileDto(row: ProfileRow) {
  return {
    displayName: row.displayName,
    preferredName: row.preferredName,
    headline: row.headline,
    avatarEmoji: row.avatarEmoji,
    avatarColor: row.avatarColor,
    locationLabel: row.locationLabel,
    focusAreas: row.focusAreas,
    accent: row.accent as
      | 'default'
      | 'blue'
      | 'green'
      | 'amber'
      | 'rose'
      | 'violet'
      | 'mono',
    dateFormat: row.dateFormat as 'long' | 'short' | 'iso',
    showMarkets: row.showMarkets,
    showWeather: row.showWeather,
    updatedAt: Math.floor(row.updatedAt.getTime() / 1000),
  };
}

async function ensureProfile(
  db: ReturnType<typeof createDrizzleClient>,
  auth: AuthContext,
): Promise<ProfileRow> {
  const existing = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, auth.userId))
    .get();
  if (existing) return existing;

  const now = new Date();
  const row = {
    userId: auth.userId,
    displayName: null,
    preferredName: null,
    headline: null,
    avatarEmoji: null,
    avatarColor: null,
    locationLabel: null,
    focusAreas: null,
    accent: 'default',
    dateFormat: 'long',
    showMarkets: true,
    showWeather: true,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(userProfiles).values(row).run();
  return row;
}

export default composeHandler(async (req: Request): Promise<Response> => {
  const auth = await requireAuth(req);
  const url = new URL(req.url);
  if (url.pathname !== '/api/profile') {
    throw new HttpError(404, 'route_not_found', 'Route not found');
  }

  const db = createDrizzleClient();

  if (req.method === 'GET') {
    const row = await ensureProfile(db, auth);
    return jsonResponse(200, profileDto(row));
  }

  if (req.method === 'PATCH') {
    const body = PatchBody.parse(await req.json());
    await ensureProfile(db, auth); // make sure row exists

    // Build the update object from only the fields the client provided.
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if ('displayName' in body) updates.displayName = body.displayName;
    if ('preferredName' in body) updates.preferredName = body.preferredName;
    if ('headline' in body) updates.headline = body.headline;
    if ('avatarEmoji' in body) updates.avatarEmoji = body.avatarEmoji;
    if ('avatarColor' in body) updates.avatarColor = body.avatarColor;
    if ('locationLabel' in body) updates.locationLabel = body.locationLabel;
    if ('focusAreas' in body) updates.focusAreas = body.focusAreas;
    if ('accent' in body) updates.accent = body.accent;
    if ('dateFormat' in body) updates.dateFormat = body.dateFormat;
    if ('showMarkets' in body) updates.showMarkets = body.showMarkets;
    if ('showWeather' in body) updates.showWeather = body.showWeather;

    const updated = await db
      .update(userProfiles)
      .set(updates)
      .where(eq(userProfiles.userId, auth.userId))
      .returning()
      .get();
    if (!updated) throw new HttpError(500, 'update_failed', 'Could not update profile');
    return jsonResponse(200, profileDto(updated));
  }

  throw new HttpError(405, 'method_not_allowed', 'Method not allowed');
});
