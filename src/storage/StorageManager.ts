import * as fs from 'fs';
import * as path from 'path';
import { CookieJar } from 'tough-cookie';

// Type definitions for node-localstorage
declare class LocalStorage {
    constructor(path: string);
    setItem(key: string, value: string): void;
    getItem(key: string): string | null;
    removeItem(key: string): void;
    clear(): void;
    key(index: number): string | null;
    get length(): number;
}

// Dynamic import for node-localstorage
let LocalStorageClass: any = null;

async function getLocalStorage(storageDir: string): Promise<LocalStorage> {
    if (!LocalStorageClass) {
        // node-localstorage needs to be required at runtime
        const localStorageModule = require('node-localstorage');
        LocalStorageClass = localStorageModule.LocalStorage;
    }
    return new LocalStorageClass(storageDir);
}

/**
 * In-memory sessionStorage implementation
 * Data is cleared when the browser session ends
 */
export class BrowserSessionStorage {
    private storage: Map<string, string> = new Map();

    setItem(key: string, value: string): void {
        this.storage.set(key, value);
    }

    getItem(key: string): string | null {
        return this.storage.get(key) ?? null;
    }

    removeItem(key: string): void {
        this.storage.delete(key);
    }

    clear(): void {
        this.storage.clear();
    }

    key(index: number): string | null {
        const keys = Array.from(this.storage.keys());
        return keys[index] ?? null;
    }

    get length(): number {
        return this.storage.size;
    }

    toJSON(): Record<string, string> {
        const obj: Record<string, string> = {};
        this.storage.forEach((value, key) => {
            obj[key] = value;
        });
        return obj;
    }

    fromJSON(obj: Record<string, string>): void {
        this.storage.clear();
        Object.entries(obj).forEach(([key, value]) => {
            this.storage.set(key, value);
        });
    }
}

/**
 * Storage Manager for Visual Browser
 * Handles cookies, localStorage, and sessionStorage persistence
 */
export class StorageManager {
    private _storageDir: string;
    private _cookieJar: CookieJar | null = null;
    private _localStorage: LocalStorage | null = null;
    private _sessionStorage: BrowserSessionStorage;
    private _initialized: boolean = false;

    constructor(storageDir: string) {
        this._storageDir = storageDir;
        this._sessionStorage = new BrowserSessionStorage();
    }

    /**
     * Initialize storage - must be called before using
     */
    async initialize(): Promise<void> {
        if (this._initialized) return;

        // Ensure storage directory exists
        if (!fs.existsSync(this._storageDir)) {
            fs.mkdirSync(this._storageDir, { recursive: true });
        }

        // Initialize localStorage
        this._localStorage = await getLocalStorage(this._storageDir);

        // Initialize cookie jar with file persistence using tough-cookie's built-in serialization
        const cookieFilePath = path.join(this._storageDir, 'cookies.json');
        
        // Check if cookie file exists and load it
        if (fs.existsSync(cookieFilePath)) {
            try {
                const cookieData = fs.readFileSync(cookieFilePath, 'utf8');
                const cookies = JSON.parse(cookieData);
                this._cookieJar = CookieJar.fromJSON(cookies);
            } catch (e) {
                console.log('[StorageManager] Failed to load cookies, creating new jar');
                this._cookieJar = new CookieJar();
            }
        } else {
            this._cookieJar = new CookieJar();
        }

        this._initialized = true;
        console.log('[StorageManager] Initialized at:', this._storageDir);
    }

    /**
     * Save cookies to disk
     */
    async saveCookies(): Promise<void> {
        if (!this._cookieJar) return;

        const cookieFilePath = path.join(this._storageDir, 'cookies.json');
        try {
            const cookieData = this._cookieJar.toJSON();
            fs.writeFileSync(cookieFilePath, JSON.stringify(cookieData, null, 2));
        } catch (e) {
            console.error('[StorageManager] Failed to save cookies:', e);
        }
    }

    /**
     * Get cookie header for a URL
     */
    async getCookieHeader(url: string): Promise<string> {
        if (!this._cookieJar) return '';
        
        return new Promise((resolve) => {
            this._cookieJar!.getCookies(url, (err: Error | null, cookies: any) => {
                if (err || !cookies) {
                    resolve('');
                    return;
                }
                const cookieArray = Array.isArray(cookies) ? cookies : [];
                resolve(cookieArray.map((c: any) => c.cookieString()).join('; '));
            });
        });
    }

    /**
     * Set cookie from response Set-Cookie header
     */
    async setCookie(cookieString: string, url: string): Promise<void> {
        if (!this._cookieJar) return;

        return new Promise((resolve) => {
            this._cookieJar!.setCookie(cookieString, url, (err: Error | null) => {
                if (err) {
                    console.error('[StorageManager] Failed to set cookie:', err);
                }
                // Auto-save after setting cookie
                this.saveCookies();
                resolve();
            });
        });
    }

    /**
     * Get localStorage value
     */
    getLocalStorageItem(key: string): string | null {
        if (!this._localStorage) return null;
        return this._localStorage.getItem(key);
    }

    /**
     * Set localStorage value
     */
    setLocalStorageItem(key: string, value: string): void {
        if (!this._localStorage) return;
        this._localStorage.setItem(key, value);
    }

    /**
     * Remove localStorage value
     */
    removeLocalStorageItem(key: string): void {
        if (!this._localStorage) return;
        this._localStorage.removeItem(key);
    }

    /**
     * Get all localStorage data as JSON string
     */
    getLocalStorageAsJSON(): string {
        if (!this._localStorage) return '{}';
        
        const obj: Record<string, string> = {};
        for (let i = 0; i < this._localStorage.length; i++) {
            const key = this._localStorage.key(i);
            if (key) {
                obj[key] = this._localStorage.getItem(key) || '';
            }
        }
        return JSON.stringify(obj);
    }

    /**
     * Get sessionStorage value
     */
    getSessionStorageItem(key: string): string | null {
        return this._sessionStorage.getItem(key);
    }

    /**
     * Set sessionStorage value
     */
    setSessionStorageItem(key: string, value: string): void {
        this._sessionStorage.setItem(key, value);
    }

    /**
     * Remove sessionStorage value
     */
    removeSessionStorageItem(key: string): void {
        this._sessionStorage.removeItem(key);
    }

    /**
     * Clear sessionStorage
     */
    clearSessionStorage(): void {
        this._sessionStorage.clear();
    }

    /**
     * Get all sessionStorage data as JSON string
     */
    getSessionStorageAsJSON(): string {
        return JSON.stringify(this._sessionStorage.toJSON());
    }

    /**
     * Clear all storage (except cookies)
     */
    clearAll(): void {
        if (this._localStorage) {
            this._localStorage.clear();
        }
        this._sessionStorage.clear();
    }

    /**
     * Get the storage directory path
     */
    get storageDir(): string {
        return this._storageDir;
    }
}
