import preact from "preact";
import { getFileSystemPointer, storeFileSystemPointer } from "./fileSystemPointer";
import { observable } from "../misc/mobxTyped";
import { observer } from "../misc/observer";
import { lazy } from "socket-function/src/caching";
import { css } from "typesafecss";
import { IStorageRaw } from "./IStorage";

let handleToId = new Map<FileSystemDirectoryHandle, string>();
let displayData = observable({
    ui: undefined as undefined | preact.ComponentChildren,
}, undefined, { deep: false });

@observer
class DirectoryPrompter extends preact.Component {
    render() {
        if (!displayData.ui) return undefined;
        return (
            <div className={
                css.position("fixed").pos(0, 0).size("100vw", "100vh")
                    .zIndex(1)
                    .background("white")
                    .center
                    .fontSize(40)
            }>
                {displayData.ui}
            </div>
        );
    }
}

export const getFileStorage = lazy(async function getFileStorage(): Promise<FileStorage> {
    let handle = await getDirectoryHandle();
    let id = handleToId.get(handle);
    if (!id) throw new Error("Missing id for handle");
    return wrapHandle(handle, id);
});

type NestedFileStorage = {
    hasKey(key: string): Promise<boolean>;
    getStorage(key: string): Promise<FileStorage>;
    removeStorage(key: string): Promise<void>;
    getKeys(): Promise<string[]>;

    // Break apart back slashes to read nested paths
    readNestedPath(path: string[]): Promise<Buffer | undefined>;
    statNestedPath(path: string[]): Promise<{ size: number; lastModified: number; } | undefined>;
    getNestedFileHandle(path: string[]): Promise<FileSystemFileHandle | undefined>;
};

export type FileStorage = IStorageRaw & {
    id: string;
    folder: NestedFileStorage;
};


function wrapHandleFiles(handle: FileSystemDirectoryHandle): IStorageRaw {
    return {
        async get(key: string): Promise<Buffer | undefined> {
            try {
                const file = await handle.getFileHandle(key);
                const fileContent = await file.getFile();
                const arrayBuffer = await fileContent.arrayBuffer();
                return Buffer.from(arrayBuffer);
            } catch (error) {
                return undefined;
            }
        },

        async append(key: string, value: Buffer): Promise<void> {
            // NOTE: Interesting point. Chrome doesn't optimize this to be an append, and instead
            //  rewrites the entire file.
            const file = await handle.getFileHandle(key, { create: true });
            const writable = await file.createWritable({ keepExistingData: true });
            let offset = (await file.getFile()).size;
            await writable.seek(offset);
            await writable.write(value);
            await writable.close();
        },

        async set(key: string, value: Buffer): Promise<void> {
            const file = await handle.getFileHandle(key, { create: true });
            const writable = await file.createWritable();
            await writable.write(value);
            await writable.close();
        },

        async remove(key: string): Promise<void> {
            await handle.removeEntry(key);
        },

        async getKeys(): Promise<string[]> {
            const keys: string[] = [];
            for await (const [name, entry] of handle) {
                if (entry.kind === "file") {
                    keys.push(entry.name);
                }
            }
            return keys;
        },
    };
}

function wrapHandleNested(handle: FileSystemDirectoryHandle, id: string): NestedFileStorage {

    async function getNestedFileHandle(path: string[]): Promise<FileSystemFileHandle | undefined> {
        let curDir = handle;
        for (let part of path.slice(0, -1)) {
            if (!part) continue;
            try {
                curDir = await curDir.getDirectoryHandle(part, { create: false });
            } catch {
                return undefined;
            }
        }

        try {
            return await curDir.getFileHandle(path.at(-1)!, { create: false });
        } catch {
            return undefined;
        }
    }

    return {

        async hasKey(key: string): Promise<boolean> {
            try {
                await handle.getDirectoryHandle(key);
                return true;
            } catch (error) {
                return false;
            }
        },

        async getStorage(key: string): Promise<FileStorage> {
            const subDirectory = await handle.getDirectoryHandle(key, { create: true });
            return wrapHandle(subDirectory, id);
        },

        async removeStorage(key: string): Promise<void> {
            await handle.removeEntry(key, { recursive: true });
        },

        async getKeys(): Promise<string[]> {
            const keys: string[] = [];
            for await (const [name, entry] of handle) {
                if (entry.kind === "directory") {
                    keys.push(entry.name);
                }
            }
            return keys;
        },

        getNestedFileHandle,

        async readNestedPath(paths: string[]) {
            if (paths.length === 0) return undefined;
            let handle = await getNestedFileHandle(paths);
            if (!handle) return undefined;
            try {
                let file = await handle.getFile();
                let buffer = await file.arrayBuffer();
                return Buffer.from(buffer);
            } catch {
                return undefined;
            }
        },

        async statNestedPath(paths: string[]) {
            if (paths.length === 0) return undefined;
            let handle = await getNestedFileHandle(paths);
            if (!handle) return undefined;
            try {
                let file = await handle.getFile();
                return {
                    size: file.size,
                    lastModified: file.lastModified,
                };
            } catch {
                return undefined;
            }
        }
    };
}

function wrapHandle(handle: FileSystemDirectoryHandle, id: string): FileStorage {
    return {
        ...wrapHandleFiles(handle),
        folder: wrapHandleNested(handle, id),
        id,
    };
}

// NOTE: Blocks until the user provides a directory
export const getDirectoryHandle = lazy(async function getDirectoryHandle(): Promise<FileSystemDirectoryHandle> {
    let root = document.createElement("div");
    document.body.appendChild(root);
    preact.render(<DirectoryPrompter />, root);
    try {

        let handle: FileSystemDirectoryHandle | undefined;

        let storedId = localStorage.getItem("syncFileSystem");
        if (storedId) {
            let doneLoad = false;
            setTimeout(() => {
                if (doneLoad) return;
                console.log("Waiting for user to click");
                displayData.ui = "Click anywhere to allow file system access";
            }, 500);
            try {
                handle = await tryToLoadPointer(storedId);
            } catch { }
            doneLoad = true;
            if (handle) {
                handleToId.set(handle, storedId);
                return handle;
            }
        }
        let fileCallback: (handle: FileSystemDirectoryHandle) => void;
        let promise = new Promise<FileSystemDirectoryHandle>(resolve => {
            fileCallback = resolve;
        });
        displayData.ui = (
            <button
                className={css.fontSize(40).pad2(80, 40)}
                onClick={async () => {
                    console.log("Waiting for user to give permission");
                    const handle = await window.showDirectoryPicker();
                    await handle.requestPermission({ mode: "readwrite" });
                    let storedId = await storeFileSystemPointer({ mode: "readwrite", handle });
                    localStorage.setItem("syncFileSystem", storedId);
                    handleToId.set(handle, storedId);
                    fileCallback(handle);
                }}
            >
                Pick Media Directory
            </button>
        );
        return await promise;
    } finally {
        preact.render(null, root);
        root.remove();
    }
});

export function resetDirectory() {
    localStorage.removeItem("syncFileSystem");
    window.location.reload();
}

async function tryToLoadPointer(pointer: string) {
    let result = await getFileSystemPointer({ pointer });
    if (!result) return;
    let handle = await result?.onUserActivation();
    if (!handle) return;
    return handle as FileSystemDirectoryHandle;
}


/*
import preact from "preact";
import { observer } from "./observer";
import { observable } from "mobx";
import { deleteFileSystemPointer, getFileSystemPointer, storeFileSystemPointer } from "./fileSystemPointer";
import { delay } from "socket-function/src/batching";


let cachedFiles = observable({} as {
    [path: string]: {
        loaded?: boolean;
        watching?: boolean;
        value?: Buffer;
        watchStat?: number;
    }
});
let cachedDirs = observable({} as {
    [path: string]: {
        loaded?: boolean;
        watching?: boolean;
        value?: string;
    }
});

export async function writeFile(path: string, contents: Buffer) {
    if (!currentDirectory.directory) throw new Error("Directory not set");
    let pathParts = path.split("/");
    let curDir = currentDirectory.directory;
    for (let i = 0; i < pathParts.length - 1; i++) {
        let part = pathParts[i];
        if (part === ".") continue;
        let nextDir = await curDir.getDirectoryHandle(part, { create: true });
        curDir = nextDir;
    }
    let file = await curDir.getFileHandle(pathParts.at(-1)!, { create: true });
    let writable = await file.createWritable();
    await writable.write(contents);
    await writable.close();
}

export function getFile(path: string): Buffer | undefined {
    if (!currentDirectory.directory) return undefined;
    if (!cachedFiles[path]) {
        cachedFiles[path] = {};
        void loadFile(path);
    }
    return cachedFiles[path].value;
}
export async function getFilePromise(path: string): Promise<Buffer | undefined> {
    if (!currentDirectory.directory) return undefined;
    if (!cachedFiles[path]) {
        cachedFiles[path] = {};
        await loadFile(path);
    }
    return cachedFiles[path].value;
}
export function watchFile(path: string): Buffer | undefined {
    if (!currentDirectory.directory) return undefined;
    let result = getFile(path);
    // TODO: Unwatch files as well?
    if (!cachedFiles[path].watching) {
        cachedFiles[path].watching = true;
        void runFilePoll(path);
    }
    return result;
}
export function watchDirectory(path: string): string[] {
    if (!currentDirectory.directory) return [];
    if (!cachedDirs[path]) {
        cachedDirs[path] = {};
    }
    if (!cachedDirs[path].watching) {
        cachedDirs[path].watching = true;
        void runDirPoll(path);
    }
    return cachedDirs[path].value?.split("|") || [];
}

async function runFilePoll(path: string) {
    const dir = currentDirectory.directory;
    if (!dir) throw new Error("Directory not set");
    while (true) {
        await new Promise(resolve => setTimeout(resolve, 350));
        let lastStat = await dir.getFileHandle(path, {}).catch(() => undefined);
        let file = await lastStat?.getFile();
        let lastModified = file?.lastModified;
        if (cachedFiles[path].watchStat !== lastModified) {
            await loadFile(path);
            cachedFiles[path].watchStat = lastModified;
        }
    }
}

async function loadFile(path: string) {
    const dir = currentDirectory.directory;
    if (!dir) throw new Error("Directory not set");

    let pathParts = path.split("/");
    let curDir = dir;

    try {
        for (let i = 0; i < pathParts.length - 1; i++) {
            let part = pathParts[i];
            if (part === ".") continue;
            let nextDir = await curDir.getDirectoryHandle(part, { create: true });
            curDir = nextDir;
        }
        let file = await curDir.getFileHandle(pathParts.at(-1)!, { create: false });
        let fileContents = await file.getFile();
        let buffer = await fileContents.arrayBuffer();
        cachedFiles[path].value = Buffer.from(buffer);
    } catch (e) {
        cachedFiles[path].value = undefined;
    }
    cachedFiles[path].loaded = true;
}


async function runDirPoll(path: string) {
    const dir = currentDirectory.directory;
    if (!dir) throw new Error("Directory not set");
    while (true) {
        await loadDir(path);
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
}

async function loadDir(path: string) {
    const dir = currentDirectory.directory;
    if (!dir) throw new Error("Directory not set");

    let pathParts = path.split("/");
    let curDir = dir;

    try {
        for (let i = 0; i < pathParts.length; i++) {
            let part = pathParts[i];
            if (part === ".") continue;
            let nextDir = await curDir.getDirectoryHandle(part, { create: true });
            curDir = nextDir;
        }
        let newParts: string[] = [];
        for await (let [name, value] of curDir) {
            newParts.push(name);
        }
        let newDir = newParts.join("|");
        if (newDir !== cachedDirs[path].value) {
            cachedDirs[path].value = newDir;
        }
    } catch (e) {
        cachedDirs[path].value = undefined;
    }
    cachedDirs[path].loaded = true;

    return cachedDirs[path].value;
}


*/