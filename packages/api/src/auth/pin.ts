import { eq } from 'drizzle-orm';
import { db, userProfiles } from '../db';

const PIN_MIN_LENGTH = 4;
const PIN_MAX_LENGTH = 8;

export async function setPin(userId: string, pin: string): Promise<void> {
  if (pin.length < PIN_MIN_LENGTH || pin.length > PIN_MAX_LENGTH) {
    throw new Error(`PIN must be between ${PIN_MIN_LENGTH} and ${PIN_MAX_LENGTH} digits`);
  }

  if (!/^\d+$/.test(pin)) {
    throw new Error('PIN must contain only digits');
  }

  const hash = await Bun.password.hash(pin, {
    algorithm: 'bcrypt',
    cost: 10,
  });

  // Upsert user profile with pin
  const existing = await db.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, userId),
  });

  if (existing) {
    await db.update(userProfiles)
      .set({ pinHash: hash, updatedAt: new Date() })
      .where(eq(userProfiles.userId, userId));
  } else {
    await db.insert(userProfiles).values({
      userId,
      pinHash: hash,
    });
  }
}

export async function verifyPin(userId: string, pin: string): Promise<boolean> {
  const profile = await db.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, userId),
  });

  if (!profile?.pinHash) {
    return false;
  }

  return Bun.password.verify(pin, profile.pinHash);
}

export async function hasPin(userId: string): Promise<boolean> {
  const profile = await db.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, userId),
    columns: { pinHash: true },
  });

  return !!profile?.pinHash;
}

export async function removePin(userId: string): Promise<void> {
  await db.update(userProfiles)
    .set({ pinHash: null, updatedAt: new Date() })
    .where(eq(userProfiles.userId, userId));
}
