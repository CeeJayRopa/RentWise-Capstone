export const login = async (credentials: { email: string; password: string }) => {
  // TODO: implement authentication against API
  return Promise.resolve({ token: 'stub-token' });
};

export const logout = async () => {
  // TODO: clear session / token
  return Promise.resolve();
};
