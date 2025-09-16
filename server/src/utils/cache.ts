interface CacheItem<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

export class MemoryCache {
  private cache: Map<string, CacheItem<any>> = new Map();
  private defaultTTL: number = 5 * 60 * 1000; // 5 minutes default

  constructor(defaultTTL?: number) {
    if (defaultTTL) {
      this.defaultTTL = defaultTTL;
    }

    // Clean up expired entries every minute
    setInterval(() => this.cleanup(), 60 * 1000);
  }

  set<T>(key: string, data: T, ttl?: number): void {
    const ttlMs = ttl || this.defaultTTL;
    const now = Date.now();

    this.cache.set(key, {
      data,
      timestamp: now,
      expiresAt: now + ttlMs,
    });
  }

  get<T>(key: string): T | null {
    const item = this.cache.get(key);

    if (!item) {
      return null;
    }

    // Check if expired
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return item.data as T;
  }

  has(key: string): boolean {
    const item = this.cache.get(key);
    if (!item) return false;

    // Check if expired
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  // Clear entries matching a pattern
  clearPattern(pattern: string): void {
    const regex = new RegExp(pattern);
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
      }
    }
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, item] of this.cache.entries()) {
      if (now > item.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  getStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}

// Singleton instance
export const apiCache = new MemoryCache();

// Cache key generators
export const cacheKeys = {
  purchases: (userId: string) => `purchases:${userId}`,
  purchaseStats: (userId: string) => `purchase-stats:${userId}`,
  emailAnalysis: (emailId: string, userId: string) => `email-analysis:${emailId}:${userId}`,
  vendors: (userId: string) => `vendors:${userId}`,
  categories: (userId: string) => `categories:${userId}`,
};