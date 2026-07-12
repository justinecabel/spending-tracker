export const storage = {
  getItem(name: string) {
    if (typeof window === "undefined") {
      return Promise.resolve(null);
    }
    return Promise.resolve(window.localStorage.getItem(name));
  },
  setItem(name: string, value: string) {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(name, value);
    }
    return Promise.resolve();
  },
  removeItem(name: string) {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(name);
    }
    return Promise.resolve();
  },
};
