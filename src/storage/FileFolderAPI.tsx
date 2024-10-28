import preact from "preact";
import { getFileSystemPointer, storeFileSystemPointer } from "./fileSystemPointer";
import { observable } from "../misc/mobxTyped";
import { observer } from "../misc/observer";
import { cache, lazy } from "socket-function/src/caching";
import { css, isNode } from "typesafecss";
import { IStorageRaw } from "./IStorage";
import { runInSerial } from "socket-function/src/batching";
import { getSpeedFolderName } from "../urlParams";

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

export const getFileStorage = lazy(async function getFileStorage(): Promise<FileStorage> {
    if (isNode()) return "No file storage in NodeJS. Is the build script running startup steps? Check for isNode() and NOOP those" as any;
    let handle = await getDirectoryHandle();
    let id = handleToId.get(handle);
    if (!id) throw new Error("Missing id for handle");
    let folderName = getSpeedFolderName();
    let selected: FileSystemDirectoryHandle;
    try {
        selected = await handle.getDirectoryHandle(folderName, { create: false });
    } catch {
        selected = await handle.getDirectoryHandle(folderName, { create: true });
    }
    return wrapHandle(selected, id);
});
export const getFileStorageRoot = lazy(async function getFileStorage(): Promise<FileStorage> {
    if (isNode()) return "No file storage in NodeJS. Is the build script running startup steps? Check for isNode() and NOOP those" as any;
    let handle = await getDirectoryHandle();
    let id = handleToId.get(handle);
    if (!id) throw new Error("Missing id for handle");
    return wrapHandle(handle, id);
});
export function resetStorageLocation() {
    localStorage.removeItem("syncFileSystem");
    window.location.reload();
}

type NestedFileStorage = {
    hasKey(key: string): Promise<boolean>;
    getStorage(key: string): Promise<FileStorage>;
    removeStorage(key: string): Promise<void>;
    getKeys(): Promise<string[]>;

    // Break apart back slashes to read nested paths
    readNestedPath(path: string[]): Promise<Buffer | undefined>;
    statNestedPath(path: string[]): Promise<{ size: number; lastModified: number; } | undefined>;
    getNestedFileHandle(path: string[], create?: "create"): Promise<FileSystemFileHandle | undefined>;
};

export type FileStorage = IStorageRaw & {
    id: string;
    folder: NestedFileStorage;
};

let appendQueue = cache((key: string) => {
    return runInSerial((fnc: () => Promise<void>) => fnc());
});


async function fixedGetFileHandle(config: {
    handle: FileSystemDirectoryHandle;
    key: string;
    create: true;
}): Promise<FileSystemFileHandle>;
async function fixedGetFileHandle(config: {
    handle: FileSystemDirectoryHandle;
    key: string;
    create?: boolean;
}): Promise<FileSystemFileHandle | undefined>;
async function fixedGetFileHandle(config: {
    handle: FileSystemDirectoryHandle;
    key: string;
    create?: boolean;
}): Promise<FileSystemFileHandle | undefined> {
    // ALWAYS try without create, because the sshfs-win sucks and doesn't support `create: true`? Wtf...
    try {
        return await config.handle.getFileHandle(config.key);
    } catch {
        if (!config.create) return undefined;
    }
    return await config.handle.getFileHandle(config.key, { create: true });
}

function wrapHandleFiles(handle: FileSystemDirectoryHandle): IStorageRaw {
    return {
        async getInfo(key: string) {
            try {
                const file = await handle.getFileHandle(key);
                const fileContent = await file.getFile();
                return {
                    size: fileContent.size,
                    lastModified: fileContent.lastModified,
                };
            } catch (error) {
                return undefined;
            }
        },
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
            await appendQueue(key)(async () => {
                // NOTE: Interesting point. Chrome doesn't optimize this to be an append, and instead
                //  rewrites the entire file.
                const file = await fixedGetFileHandle({ handle, key, create: true });
                const writable = await file.createWritable({ keepExistingData: true });
                let offset = (await file.getFile()).size;
                await writable.seek(offset);
                await writable.write(value);
                await writable.close();
            });
        },

        async set(key: string, value: Buffer): Promise<void> {
            const file = await fixedGetFileHandle({ handle, key, create: true });
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

        async reset() {
            for await (const [name, entry] of handle) {
                await handle.removeEntry(entry.name, { recursive: true });
            }
        },
    };
}

function wrapHandleNested(handle: FileSystemDirectoryHandle, id: string): NestedFileStorage {

    async function getNestedFileHandle(path: string[], create?: "create"): Promise<FileSystemFileHandle | undefined> {
        let curDir = handle;
        //for (let part of path.slice(0, -1)) {
        for (let i = 0; i < path.length - 1; i++) {
            let part = path[i];
            if (!part) continue;
            try {
                // NOTE: We don't create directories here, because if the final file isn't found,
                //  we don't want to create the directory structure.
                curDir = await curDir.getDirectoryHandle(part, { create: false });
            } catch {
                // Create dir and file
                if (create) {
                    for (let j = i; j < path.length - 1; j++) {
                        let part = path[j];
                        if (!part) continue;
                        curDir = await curDir.getDirectoryHandle(part, { create: true });
                    }
                    return curDir.getFileHandle(path.at(-1)!, { create: true });
                }
                return undefined;
            }
        }

        try {
            return await fixedGetFileHandle({ handle: curDir, key: path.at(-1)!, create: !!create });
        } catch (e) {
            console.error("getNestedFileHandle", e);
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

function wrapHandle(handle: FileSystemDirectoryHandle, id = "default"): FileStorage {
    return {
        ...wrapHandleFiles(handle),
        folder: wrapHandleNested(handle, id),
        id,
    };
}

async function tryToLoadPointer(pointer: string) {
    let result = await getFileSystemPointer({ pointer });
    if (!result) return;
    let handle = await result?.onUserActivation();
    if (!handle) return;
    return handle as FileSystemDirectoryHandle;
}