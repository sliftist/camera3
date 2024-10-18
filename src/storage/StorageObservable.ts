import { observable } from "../misc/mobxTyped";
import { IStorage, IStorageSync } from "./IStorage";

// Assumes it is the only writer
export class StorageSync<T> implements IStorageSync<T> {
    cached = observable.map<string, T | undefined>();
    keys = new Set<string>();
    synced = observable({
        keySeqNum: 0,
    }, undefined, { deep: false });

    constructor(private storage: IStorage<T>) { }

    public get(key: string): T | undefined {
        if (!this.cached.has(key)) {
            this.cached.set(key, undefined);
            void this.storage.get(key).then(value => {
                this.cached.set(key, value);
            });
        }
        if (this.cached.get(key) === undefined) {
            this.synced.keySeqNum;
        }
        return this.cached.get(key);
    }
    public set(key: string, value: T): void {
        if (!this.keys.has(key)) {
            this.keys.add(key);
            this.synced.keySeqNum++;
        }
        this.cached.set(key, value);
        void this.storage.set(key, value);
    }
    public remove(key: string): void {
        if (this.keys.has(key)) {
            this.keys.delete(key);
            this.synced.keySeqNum++;
        }
        this.cached.delete(key);
        void this.storage.remove(key);
    }
    private loadedKeys = false;
    public getKeys(): string[] {
        if (!this.loadedKeys) {
            this.loadedKeys = true;
            void this.storage.getKeys().then(keys => {
                this.keys = new Set(keys);
                this.synced.keySeqNum++;
            });
        }
        this.synced.keySeqNum;
        return Array.from(this.keys);
    }
}