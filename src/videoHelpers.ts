import { sort, throttleFunction } from "socket-function/src/misc";
import { FileStorageSynced } from "./storage/DiskCollection";
import { observable } from "./misc/mobxTyped";

const MAX_ASSUMED_FILE_TIME = 1000 * 60 * 60 * 15;

function isVideo(file: string): boolean {
    return file.startsWith("segment_") && file.endsWith(".nal");
}

export const decodeVideoKey = parseVideoKey;
export function parseVideoKey(key: string) {
    if (!isVideo(key)) return undefined;
    let match = (
        // segment_2024_9_20__10_49_2__frames_120__end_1729727238000.nal
        key.match(/segment_(\d+)_(\d+)_(\d+)__(\d+)_(\d+)_(\d+)__frames_(\d+)__end_*(\d+).*\.nal/)
    );
    if (!match) return undefined;
    let [, year, month, day, hour, minute, second, frames, endTime] = match;
    return {
        // time is from the modified timestamp, so it's usually off by a few seconds.
        time: Date.UTC(+year, +month, +day, +hour, +minute, +second),
        // endTime is a GUESS. It's set based on the next file / when the file was moved,
        //  so it could be massively off.
        endTime: +endTime || 0,
        frames: +frames || 0,
    };
}

export function getVideoStartTime(key: string): number {
    return parseVideoKey(key)?.time || 0;
}

export const getVideosSync = getVideoTimeline;
export const getLiveVideos = getVideoTimeline;
export const getAllVideos = getVideoTimeline;
export function getVideoTimeline() {
    let allFiles = FileStorageSynced.getKeys();
    let timeline: { file: string; time: number; endTime: number; frames: number; }[] = [];
    for (let file of allFiles) {
        let obj = parseVideoKey(file);
        if (!obj) continue;
        timeline.push({
            file,
            time: obj.time,
            endTime: obj.endTime,
            frames: obj.frames,
        });
    }
    sort(timeline, x => x.time);
    return timeline;
}


export async function findVideo(time: number): Promise<string> {
    let allFiles = await FileStorageSynced.getAsync().getKeysPromise();
    return findVideoBase(time, allFiles);
}
export function findVideoSync(time: number): string {
    let allFiles = FileStorageSynced.getKeys();
    return findVideoBase(time, allFiles);
}
function findVideoBase(time: number, allFiles: string[]): string {
    allFiles = allFiles.filter(isVideo);
    allFiles.sort();
    allFiles.reverse();
    let index = allFiles.findIndex(x => getVideoStartTime(x) <= time);
    return allFiles[index] || allFiles[0];
}

export async function findNextVideo(file: string, freshKeys?: "fresh"): Promise<string | undefined> {
    let time = getVideoStartTime(file);

    let allFiles = freshKeys ? await FileStorageSynced.getAsync().getKeysPromise() : FileStorageSynced.getKeys();
    allFiles = allFiles.filter(isVideo);
    allFiles.sort();
    allFiles.reverse();
    let index = allFiles.findIndex(x => getVideoStartTime(x) <= time);
    let next = allFiles[index - 1];
    if (!next && !freshKeys) {
        await resetKeys();
        return findNextVideo(file, "fresh");
    }
    return next;
}


export function estimateFPS(time: number) {
    let currentVideo = findVideoSync(time);
    let parsed = parseVideoKey(currentVideo);
    if (!parsed) return undefined;
    return parsed.frames / (parsed.endTime - parsed.time) * 1000;
}

const resetKeys = throttleFunction(1000, async () => {
    console.log("Resetting keys");
    FileStorageSynced.getAsync().resetKeys();
});