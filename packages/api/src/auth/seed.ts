import { eq } from 'drizzle-orm';
import { auth } from './index';
import { isLocalMode } from '../config/mode';
import { userInfo } from 'node:os';
import { db } from '../db';
import { user as userTable } from '../db/schema';

function getDefaultUser() {
  if (isLocalMode()) {
    const osUser = userInfo().username;
    return {
      name: osUser,
      email: `${osUser}@local.machine`,
      password: 'local-mode',
    };
  }
  return {
    name: 'Test User',
    email: 'test@t.com',
    password: '123456',
  };
}

// Local mode is single-user on loopback — no pairing. Resolves the seeded local
// user so the embedded notch app (and other tokenless localhost clients) authenticate.
export async function getLocalUserId(): Promise<string | null> {
  if (!isLocalMode()) return null;
  const email = `${userInfo().username}@local.machine`;
  const u = await db.query.user.findFirst({ where: eq(userTable.email, email) });
  return u?.id ?? null;
}

export async function seedTestUser() {
  const user = getDefaultUser();

  try {
    // Try to sign in first to check if user exists
    const signInResult = await auth.api.signInEmail({
      body: {
        email: user.email,
        password: user.password,
      },
    });

    if (signInResult) {
      console.log(`${isLocalMode() ? 'Local' : 'Test'} user already exists`);
      return;
    }
  } catch {
    // User doesn't exist, create it
  }

  try {
    await auth.api.signUpEmail({
      body: {
        name: user.name,
        email: user.email,
        password: user.password,
      },
    });
    console.log(`${isLocalMode() ? 'Local' : 'Test'} user created: ${user.email}`);
  } catch (error) {
    // User might already exist
    console.log('User setup complete');
  }
}
