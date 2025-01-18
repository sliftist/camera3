import { lazy } from "socket-function/src/caching";
import { observable } from "./misc/mobxTyped";
import { FileStorage, getFileStorage, getFileStorageRoot } from "./storage/FileFolderAPI";
import { sort, throttleFunction, timeInMinute } from "socket-function/src/misc";
import { getDirMaximumChangeTime } from "./frameEmitHelpers";
import { DiskCollectionPromise } from "./storage/DiskCollection";
import { decodeVideoKey, deleteActivityCache, isVideoFile, parseVideoKey, VideoFileObj } from "./videoHelpers";
import { delay, runInfinitePoll } from "socket-function/src/batching";
import { getVideoManager } from "./VideoManager";
import { getSpeed } from "./urlParams";
import { formatNumber, formatTime } from "socket-function/src/formatting/format";

const FAST_POLL_DELAY = 1000;
const MEDIUM_POLL_DELAY = timeInMinute;
const SLOW_FOLDER_STEP_DELAY = 1000 * 10;


let filePathCache = new DiskCollectionPromise("videoPaths3", 5000);
// Wait a while to freeze, we we can sure the file values are written too
let frozenFolderCache = new DiskCollectionPromise("frozenFolders3", 30000);

export async function deleteVideoCache() {
    await filePathCache.reset();
    await frozenFolderCache.reset();
}

export async function forceRecheckAllNow() {
    await frozenFolderCache.reset();
    await pollVideoFilesNow();
}

let availableSpeeds = observable({
    value: [1] as number[],
}, undefined, { deep: false });
const getAvailableSpeedsPromise = lazy(async () => {
    let rootFileSystem = await getFileStorageRoot();
    let speedStrings = await rootFileSystem.folder.getKeys();
    let speeds = speedStrings.filter(x => x.endsWith("x")).map(x => +x.slice(0, -1)).filter(x => !isNaN(x));
    if (!speeds.includes(1)) {
        speeds.push(1);
    }
    sort(speeds, x => x);
    availableSpeeds.value = speeds;
    return speeds;
});

export function getAvailableSpeeds() {
    void getAvailableSpeedsPromise();
    return availableSpeeds.value;
}

// Max gap within a range
function getRangeMaximumGap() {
    // Basically 30 frames, if we run at 30FPS. Should be reasonable, at least for UI purposes.
    let speed = getSpeed();
    return 1000 * speed;
}
export type VideoIndex = {
    // Ordered by startTime
    ranges: {
        startTime: number;
        endTime: number;
        duration: number;
        size: number;
        videos: VideoFileObj[];
    }[];
    flatVideos: VideoFileObj[];
    totalSize: number;
};
let videoIndexCache: {
    index: VideoIndex;
    seqNum: number;
} | undefined;

let filePathCacheSeqNum = observable({
    seqNum: 0,
});

export function getVideoIndexSynced(): VideoIndex {
    void startPoll();
    if (videoIndexCache && videoIndexCache.seqNum === filePathCacheSeqNum.seqNum) {
        return videoIndexCache.index;
    }

    let time = Date.now();
    let allFiles = Array.from(filePathCacheMemory).map(file => decodeVideoKey(file)!).filter(x => x);
    sort(allFiles, x => x.startTime);

    let videoIndex: VideoIndex = {
        ranges: [],
        flatVideos: [],
        totalSize: 0,
    };

    let maxGap = getRangeMaximumGap();

    let overlap = 0;
    for (let i = allFiles.length - 1; i >= 1; i--) {
        let cur = allFiles[i];
        let prev = allFiles[i - 1];
        if (cur.startTime < prev.endTime) {
            overlap++;
            if (cur.duration > prev.duration) {
                allFiles.splice(i - 1, 1);
            } else {
                allFiles.splice(i, 1);
            }
        }
    }
    if (overlap > 0) {
        console.log(`Removed ${overlap} overlapping videos`);
    }
    // 2) Add to ranges
    for (let file of allFiles) {
        // Either add to the last range, or make a new range
        let lastRange = videoIndex.ranges.at(-1);
        if (!lastRange || lastRange.endTime + maxGap < file.startTime) {
            lastRange = { startTime: file.startTime, endTime: file.endTime, duration: 0, size: 0, videos: [] };
            videoIndex.ranges.push(lastRange);
        }
        lastRange.endTime = file.endTime;
        lastRange.size += file.size;
        lastRange.videos.push(file);
    }
    for (let range of videoIndex.ranges) {
        range.duration = range.endTime - range.startTime;
    }

    videoIndex.totalSize = videoIndex.ranges.reduce((acc, x) => acc + x.size, 0);

    // 3) Create flatVideos
    videoIndex.flatVideos = allFiles;

    let totalTime = Date.now() - time;
    if (totalTime > 100) {
        console.log(`Finished getVideoIndex creation, took ${totalTime}ms. Maybe optimize to use deltas if this happens a lot?`);
    }

    videoIndexCache = {
        index: videoIndex,
        seqNum: filePathCacheSeqNum.seqNum,
    };

    return videoIndex;
}
export async function getVideoIndexPromise() {
    await pollVideoFilesNow();
    return getVideoIndexSynced();
}


let filePathCacheMemory = new Set<string>();
let folderPathCacheMemory = new Map<string, Set<string>>();
function addFilePath(path: string) {
    filePathCacheMemory.add(path);
    let folder = getFolder(path);
    let files = folderPathCacheMemory.get(folder);
    if (!files) {
        files = new Set();
        folderPathCacheMemory.set(folder, files);
    }
    files.add(path);
}
function getFolder(path: string) {
    return path.split("/").slice(0, -1).join("/") + "/";
}

const loadFilePathCache = lazy(async () => {
    let time = Date.now();
    let keys = await filePathCache.getKeys();
    for (let key of keys) {
        addFilePath(key);
    }
    filePathCacheSeqNum.seqNum++;
    console.log(`Loaded initial cache of ${formatNumber(keys.length)} files in ${formatTime(Date.now() - time)}`);
});

async function updateFolderNow(storage: FileStorage, folder: string) {
    let changeCount = 0;
    let files = await storage.getKeys();
    files = files.filter(isVideoFile).filter(parseVideoKey);
    files = files.map(x => folder + x);
    let newFilesSet = new Set(files);
    // Verify the folder obeys the maximum change time
    if (false as boolean) {
        let maxChangeTime = getDirMaximumChangeTime(folder);
        for (let file of files) {
            let info = await storage.getInfo(file);
            if (info?.lastModified || 0 > maxChangeTime) {
                console.log(`File ${file} changed at ${info?.lastModified} > ${maxChangeTime}, which is invalid.`);
                debugger;
            }
        }
    }
    let prevFiles = folderPathCacheMemory.get(folder);
    if (prevFiles) {
        for (let file of prevFiles) {
            if (!newFilesSet.has(file)) {
                filePathCacheMemory.delete(file);
                void filePathCache.remove(file);
                changeCount++;
            }
        }
        if (changeCount > 0) {
            console.log(`Removed ${changeCount} files in ${folder}`);
        }
    }
    folderPathCacheMemory.set(folder, newFilesSet);
    for (let file of files) {
        if (filePathCacheMemory.has(file)) continue;
        filePathCacheMemory.add(file);
        void filePathCache.set(file, "1");
        changeCount++;
    }
    let time = getDirMaximumChangeTime(folder);
    if (Date.now() > time) {
        let freezeAgo = Date.now() - time;
        console.log(`Freezing folder ${folder} ${formatTime(freezeAgo)} late`);
        void frozenFolderCache.set(folder, "1");
    }
    return changeCount;
}


async function* recursiveIterate(storage: FileStorage, folder: string): AsyncGenerator<{ storage: FileStorage, folder: string; skip: boolean; }> {
    let obj = { storage, folder, skip: false };
    yield obj;
    if (obj.skip) return;
    let folders = await storage.folder.getKeys();
    for (let childFolder of folders) {
        let nestedStorage = await storage.folder.getStorage(childFolder);
        yield* recursiveIterate(nestedStorage, folder + childFolder + "/");
    }
}



const slowDeleteRecheckLoop = lazy(async () => {
    runInfinitePoll(1000, recheckLoopOnce);
});

const lastScanKey = "lastScanned";
async function recheckLoopOnce() {
    let time = Date.now();
    for await (let obj of recursiveIterate(await getFileStorage(), "/")) {
        let changeCount = await updateFolderNow(obj.storage, obj.folder);
        if (changeCount > 0) {
            filePathCacheSeqNum.seqNum++;
        }
        await delay(SLOW_FOLDER_STEP_DELAY);
    }
    let duration = Date.now() - time;
    console.log(`Slow recheck loop took ${formatTime(duration)}`);
    localStorage.setItem(lastScanKey, JSON.stringify({
        time: Date.now(),
        duration,
    }));
}
export function getLastScannedInfo(): { time: number; duration: number; } | undefined {
    let str = localStorage.getItem(lastScanKey);
    if (!str) return;
    return JSON.parse(str);
}


let nextRecheckFiles = new Set<string>();

export const pollVideoFilesNow = throttleFunction(0, async function pollNow() {
    await loadFilePathCache();
    void slowDeleteRecheckLoop();

    let time = Date.now();

    let recheckFolders = new Set<string>();
    for (let file of nextRecheckFiles) {
        let parts = file.split("/");
        for (let i = 1; i < parts.length; i++) {
            recheckFolders.add(parts.slice(0, i).join("/") + "/");
        }
    }
    nextRecheckFiles = new Set<string>();

    let folderCheckCount = 0;

    let fileSystem = await getFileStorage();
    let changeCount = 0;
    for await (let obj of recursiveIterate(fileSystem, "/")) {
        let { storage, folder } = obj;
        let lastFolder = folder.split("/").at(-2);
        if (folder !== "/" && lastFolder?.length !== 1) {
            obj.skip = true;
            continue;
        }
        if (!recheckFolders.has(folder) && await frozenFolderCache.get(folder)) {
            obj.skip = true;
            continue;
        }
        // let timeUntilFreeze = getDirMaximumChangeTime(folder) - Date.now();
        // console.log(`Checking folder ${folder}, freezes in ${formatTime(timeUntilFreeze)}`);
        folderCheckCount++;
        changeCount += await updateFolderNow(storage, folder);
    }
    if (changeCount > 0) {
        filePathCacheSeqNum.seqNum++;
    }
    let duration = Date.now() - time;
    if (duration > 100 || folderCheckCount > 100 || changeCount > 0) {
        console.log(`Checked ${folderCheckCount} folders, ${changeCount} changes in ${formatTime(duration)}`);
    }
    localStorage.setItem(lastScanKey, JSON.stringify({
        time: Date.now(),
        duration,
    }));
});

const startPoll = lazy(async () => {
    void fastPollLoop();

    while (true) {
        try {
            await pollVideoFilesNow();
        } catch (e) {
            console.error("Error in poll loop, continuing", e);
        }
        await delay(MEDIUM_POLL_DELAY);
    }
});
const fastPollLoop = lazy(async () => {
    while (true) {
        await delay(FAST_POLL_DELAY);
        let manager = getVideoManager();
        if (!manager) continue;
        let index = getVideoIndexSynced();
        let lastRange = index.ranges.at(-1);
        if (!lastRange) continue;
        // Within a minute of the end time is basically live
        let liveTime = lastRange.endTime - timeInMinute;
        if (manager.state.targetTime >= liveTime) {
            try {
                await pollVideoFilesNow();
            } catch (e) {
                console.error("Error in fast poll loop, continuing", e);
            }
        }
    }
});

export async function recheckFileNow(file: string) {
    // Clear all parent folders from the frozen cache
    nextRecheckFiles.add(file);
    await pollVideoFilesNow();
}