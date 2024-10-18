import { isNode } from "typesafecss";
import { DelayedStorage } from "./DelayedStorage";
import { FileStorage, getFileStorage } from "./FileFolderAPI";
import { IStorage, IStorageSync } from "./IStorage";
import { JSONStorage } from "./JSONStorage";
import { StorageSync } from "./StorageObservable";
import { TransactionStorage } from "./TransactionStorage";
import { PendingStorage } from "./PendingStorage";

export class DiskCollection<T> implements IStorageSync<T> {
    constructor(private collectionName: string) { }
    async initStorage(): Promise<IStorage<T>> {
        if (isNode()) return undefined as any;
        let fileStorage = await getFileStorage();
        let collections = await fileStorage.folder.getStorage("collections");
        let curCollection = await collections.folder.getStorage(this.collectionName);
        let baseStorage = new TransactionStorage(curCollection, this.collectionName);
        return new JSONStorage<T>(baseStorage);
    }
    private baseStorage = this.initStorage();
    private synced = new StorageSync(
        new PendingStorage(`Collection (${this.collectionName})`,
            new DelayedStorage<T>(this.baseStorage)
        )
    );

    public get(key: string): T | undefined {
        return this.synced.get(key);
    }
    public async getPromise(key: string): Promise<T | undefined> {
        let base = await this.baseStorage;
        return base.get(key);
    }
    public set(key: string, value: T): void {
        this.synced.set(key, value);
    }
    public remove(key: string): void {
        this.synced.remove(key);
    }
    public getKeys(): string[] {
        return this.synced.getKeys();
    }

    public getEntries(): [string, T][] {
        return this.getKeys().map(key => [key, this.get(key)!]);
    }
    public getValues(): T[] {
        return this.getKeys().map(key => this.get(key)!);
    }
}

export class DiskCollectionPromise<T> implements IStorage<T> {
    constructor(private collectionName: string) { }
    async initStorage(): Promise<IStorage<T>> {
        if (isNode()) return undefined as any;
        let fileStorage = await getFileStorage();
        let collections = await fileStorage.folder.getStorage("collections");
        let curCollection = await collections.folder.getStorage(this.collectionName);
        let baseStorage = new TransactionStorage(curCollection, this.collectionName);
        return new JSONStorage<T>(baseStorage);
    }
    private synced = (
        new PendingStorage(`Collection (${this.collectionName})`,
            new DelayedStorage<T>(this.initStorage())
        )
    );

    public async get(key: string): Promise<T | undefined> {
        return await this.synced.get(key);
    }
    public async set(key: string, value: T): Promise<void> {
        await this.synced.set(key, value);
    }
    public async remove(key: string): Promise<void> {
        await this.synced.remove(key);
    }
    public async getKeys(): Promise<string[]> {
        return await this.synced.getKeys();
    }
}

export class DiskCollectionRaw implements IStorage<Buffer> {
    constructor(private collectionName: string) { }
    async initStorage(): Promise<IStorage<Buffer>> {
        if (isNode()) return undefined as any;
        let fileStorage = await getFileStorage();
        let collections = await fileStorage.folder.getStorage("collections");
        return await collections.folder.getStorage(this.collectionName);
    }
    private synced = (
        new PendingStorage(`Collection (${this.collectionName})`,
            new DelayedStorage(this.initStorage())
        )
    );

    public async get(key: string): Promise<Buffer | undefined> {
        return await this.synced.get(key);
    }
    public async set(key: string, value: Buffer): Promise<void> {
        await this.synced.set(key, value);
    }
    public async remove(key: string): Promise<void> {
        await this.synced.remove(key);
    }
    public async getKeys(): Promise<string[]> {
        return await this.synced.getKeys();
    }
}