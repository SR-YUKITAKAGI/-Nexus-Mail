// Simple in-memory user store for development
// In production, this should use a proper database

interface User {
  id: string;
  googleId: string;
  email: string;
  name: string;
  picture?: string;
  accessToken: string;
  refreshToken: string;
  createdAt: Date;
  updatedAt: Date;
}

const users = new Map<string, User>();

export const createOrUpdateUser = async (userData: {
  googleId: string;
  email: string;
  name: string;
  picture?: string;
  accessToken: string;
  refreshToken: string;
}): Promise<User> => {
  // Find existing user by googleId
  let user: User | undefined;
  
  for (const [, u] of users.entries()) {
    if (u.googleId === userData.googleId) {
      user = u;
      break;
    }
  }

  if (user) {
    // Update existing user
    user.accessToken = userData.accessToken;
    user.refreshToken = userData.refreshToken;
    user.updatedAt = new Date();
    users.set(user.id, user);
    return user;
  } else {
    // Create new user
    const newUser: User = {
      id: `user_${Date.now()}`,
      ...userData,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    users.set(newUser.id, newUser);
    return newUser;
  }
};

export const getUserById = async (id: string): Promise<User | null> => {
  return users.get(id) || null;
};