import { binarySearchBasic, binarySearchIndex, sort, throttleFunction } from "socket-function/src/misc";
import { DiskCollection, FileStorageSynced } from "./storage/DiskCollection";
import { observable } from "./misc/mobxTyped";
import { getVideoIndexPromise, getVideoIndexSynced, pollVideoFilesNow } from "./videoLookup";
import { getThumbMetadata, getThumbnailURL } from "./thumbnail";
import { formatDate, formatDateTime } from "socket-function/src/formatting/format";
import { lazy } from "socket-function/src/caching";

const sha256 = require("./sha256") as {
    sha256: {
        (input: string): string;
    }
};

export type VideoFileObjIn = Omit<VideoFileObj, "duration" | "file">;

export type VideoFileObj = {
    file: string;
    // The segment group start time. Used to match new frames with existing frames.
    //  - Can be used to sort, and is required when writing video, but otherwise
    //      use startTime/endTime instead.
    //  IMPORTANT! No changes should be made to a folder after this time passes. Otherwise
    //      we can't cache the folders.
    //      - The only exception is when we delete files.
    //  IMPORTANT! When emitting, this is close to startTime. BUT, when processing new video,
    //      this can be ANY time (probably the processing time). This is fine, because processing
    //      looking for the existence of the underlying video, and then when it finishes deletes
    //      that video (so processing doesn't need to prevent duplicates by searching itself).
    segmentTime: number;

    // time is from the file creation time, which could be off if multifilesink lags.
    startTime: number;
    // endTime is a GUESS. It's based on the last modified time, which could be off
    //  if the multifilesink lags on one video, then catches up on another.
    endTime: number;
    duration: number;
    frames: number;

    size: number;
};

function encodeFileObj(obj: Record<string, string | number>) {
    return Object.entries(obj).map(([key, value]) => `${key.replaceAll(/\s+/g, " ")}=${String(value).replaceAll(/\s+/g, " ")}`).join("   ");
}
function decodeFileObj(str: string) {
    str = str.split("/").at(-1)!;
    return Object.fromEntries(str.split("   ").map(x => {
        let equalIndex = x.indexOf("=");
        if (equalIndex === -1) return [x, ""];
        return [x.slice(0, equalIndex), x.slice(equalIndex + 1)];
    }));
}
export function encodeVideoKey(obj: VideoFileObjIn): string {
    let segmentTime = obj.segmentTime;
    let startTime = obj.startTime;
    let endTime = obj.endTime;
    let frames = obj.frames;
    let size = obj.size;
    let copy: VideoFileObjIn = { segmentTime, startTime, endTime, frames, size };
    return "segment " + encodeFileObj(copy) + ".nal";
}
export function encodeVideoKeyPrefix(config: { segmentTime: number; }): string {
    // Must pad, so sorting by string works.
    return "segment " + encodeFileObj({
        segmentTime: config.segmentTime,
    });
}

export function isVideoFile(file: string) {
    let fileName = file.split("/").at(-1)!;
    return fileName.startsWith("segment ") && fileName.endsWith(".nal");
}

export const decodeVideoKey = parseVideoKey;
export function parseVideoKey(key: string): VideoFileObj {
    let fullKey = key;
    // Strip the folder, the prefix, and the extension
    key = key.split("/").at(-1)!;
    key = key.split(" ").slice(1).join(" ");
    key = key.split(".").slice(0, -1).join(".");
    let fileObj: VideoFileObj = decodeFileObj(key) as any;
    fileObj.file = fullKey;
    fileObj.startTime = +fileObj.startTime;
    fileObj.endTime = +fileObj.endTime;
    fileObj.segmentTime = +fileObj.segmentTime;
    fileObj.duration = fileObj.endTime - fileObj.startTime;
    fileObj.frames = +fileObj.frames;
    fileObj.size = +fileObj.size;
    return fileObj;
}
export function getVideoStartTime(key: string): number {
    return parseVideoKey(key)?.startTime || 0;
}



export async function findVideo(time: number): Promise<string | undefined> {
    await getVideoIndexPromise();
    let file = findVideoBase(time);
    if (file) return file;
    await pollVideoFilesNow();
    return findVideoSync(time);
}
export function findVideoSync(time: number): string | undefined {
    return findVideoBase(time);
}

let thumbnailActivityCache = new DiskCollection<number>("thumbnailActivityCache");
export async function deleteActivityCache() {
    await thumbnailActivityCache.reset();
}
const hackThumbnailLoadFlag = lazy(() => {
    setTimeout(() => {
        thumbnailActivityCache.set("initialized", 1);
    }, 30000);
});

export function getThumbnailRange(maxDim: number, range: {
    start: number;
    end: number;
    threshold?: number;
}): string {
    let index = getVideoIndexSynced();
    // Prefer the center of the video, as when we have activity, this is likely
    //  where activity is happening.
    let targetTime = (range.start + range.end) / 2;
    let i = binarySearchBasic(index.flatVideos, x => x.startTime, targetTime);
    if (i < 0) i = ~i - 1;

    let beforeIndex = Math.max(0, i - 10);
    let afterIndex = Math.min(index.flatVideos.length, i + 10);
    let videos = index.flatVideos.slice(beforeIndex, afterIndex);
    videos = videos.filter(x => x.startTime >= range.start && x.endTime <= range.end);
    sort(videos, x => Math.abs(x.startTime - targetTime));

    let anyLoading = false;

    // Get the thumbnail with the most activity
    let videoByActivity: { video: VideoFileObj; activity: number; }[] = [];
    for (let video of videos) {
        if (video.startTime < range.start) continue;
        let key = sha256.sha256(video.file);
        let activity = thumbnailActivityCache.get(key);
        if (activity) {
            videoByActivity.push({ video, activity });
            continue;
        }
        // Basically... on the first load, this delays 30s. BUT, after that, the key will be there,
        //  and will show as at least 1 key in getKeys(), letting us know the data has been loaded.
        hackThumbnailLoadFlag();
        if (thumbnailActivityCache.getKeys().length === 0) continue;

        let thumb = getThumbnailURL({ file: video.file, maxDimension: maxDim, fast: true, retryErrors: true });
        if (thumb === "loading") {
            anyLoading = true;
        }
        if (thumb.startsWith("data:")) {
            let metadata = getThumbMetadata(thumb);
            let activity = metadata?.changes || 1;
            thumbnailActivityCache.set(key, activity);
            videoByActivity.push({ video, activity });
        }
    }

    if (anyLoading) return "loading";

    sort(videoByActivity, x => -x.activity);
    let bestObj = videoByActivity[0];
    if (!bestObj) return "";
    if (bestObj.activity < (range.threshold ?? 0)) return "";
    let bestVideo = bestObj.video.file;

    return getThumbnailURL({ file: bestVideo, maxDimension: maxDim, fast: true, retryErrors: true });
}

export function filterToRange<T extends { startTime: number; endTime: number }>(values: T[], range: { start: number; end: number }): T[] {
    let rangeIndexStart = binarySearchBasic(values, x => x.startTime, range.start);
    if (rangeIndexStart < 0) rangeIndexStart = ~rangeIndexStart - 1;
    rangeIndexStart = Math.max(0, rangeIndexStart);
    // Continue until we find a range that includes the start
    while (rangeIndexStart < values.length) {
        if (values[rangeIndexStart].endTime > range.start) break;
        rangeIndexStart++;
    }
    // The end is starts after the range end
    let rangeIndexEnd = rangeIndexStart;
    while (rangeIndexEnd < values.length) {
        if (values[rangeIndexEnd].startTime >= range.end) break;
        rangeIndexEnd++;
    }
    return values.slice(rangeIndexStart, rangeIndexEnd);
}

function findVideoBase(time: number): string | undefined {
    let videos = getVideoIndexSynced().flatVideos;
    let index = binarySearchBasic(videos, x => x.startTime, time);
    if (index < 0) index = ~index - 1;
    let video = videos[index];
    if (!video) return undefined;
    if (video.startTime > time) return undefined;
    if (video.endTime < time) return undefined;
    return video.file;
}

function findNextVideoBase(time: number): string | undefined {
    let videos = getVideoIndexSynced().flatVideos;
    let index = binarySearchBasic(videos, x => x.startTime, time);
    if (index < 0) index = ~index - 1;
    let video = videos[index + 1];
    if (!video) {
        return undefined;
    }
    return video.file;
}

export async function findNextVideo(time: number): Promise<string | undefined> {
    let next = findNextVideoBase(time);
    if (next) return next;
    await pollVideoFilesNow();
    return findNextVideoBase(time);
}


export function estimateFPS(time: number) {
    let currentVideo = findVideoSync(time);
    if (!currentVideo) return 0;
    let parsed = parseVideoKey(currentVideo);
    if (!parsed) return undefined;
    return parsed.frames / (parsed.endTime - parsed.startTime) * 1000;
}

const resetKeys = throttleFunction(1000, async () => {
    console.log("Resetting keys");
    FileStorageSynced.getAsync().resetKeys();
});