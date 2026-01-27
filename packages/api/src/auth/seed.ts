import { auth } from './index';

const TEST_USER = {
  name: 'Test User',
  email: 'test@t.com',
  password: '123456',
};

export async function seedTestUser() {
  try {
    // Try to sign in first to check if user exists
    const signInResult = await auth.api.signInEmail({
      body: {
        email: TEST_USER.email,
        password: TEST_USER.password,
      },
    });

    if (signInResult) {
      console.log('Test user already exists');
      return;
    }
  } catch {
    // User doesn't exist, create it
  }

  try {
    await auth.api.signUpEmail({
      body: {
        name: TEST_USER.name,
        email: TEST_USER.email,
        password: TEST_USER.password,
      },
    });
    console.log(`Test user created: ${TEST_USER.email} / ${TEST_USER.password}`);
  } catch (error) {
    // User might already exist
    console.log('Test user setup complete');
  }
}
