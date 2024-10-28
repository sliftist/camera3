import { binarySearchBasic, binarySearchIndex, sort, throttleFunction } from "socket-function/src/misc";
import { FileStorageSynced } from "./storage/DiskCollection";
import { observable } from "./misc/mobxTyped";
import { getVideoIndexPromise, getVideoIndexSynced, pollVideoFilesNow } from "./videoLookup";

const MAX_ASSUMED_FILE_TIME = 1000 * 60 * 60 * 15;

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

    // Starts at 0, then is set to 1 after we parse video for activity,
    //  and 2 when we re-encode sped up video (otherwise it is all keyframes)
    //  - If video overlaps, we ignore the video with lower priority
    //      (on ties we take higher duration).
    //  - This both serves to prevent duplicate video, and to track how
    //      processed the video is. The goal is for all video to undergo
    //      all processing steps.
    priority: number;

    // time is from the file creation time, which could be off if multifilesink lags.
    startTime: number;
    // endTime is a GUESS. It's based on the last modified time, which could be off
    //  if the multifilesink lags on one video, then catches up on another.
    endTime: number;
    duration: number;
    frames: number;
};

export function joinNALs(nals: Buffer[]) {
    function bigEndianUint32(value: number) {
        let buf = Buffer.alloc(4);
        buf.writeUInt32BE(value);
        return buf;
    }
    return Buffer.concat(nals.flatMap(nal => [bigEndianUint32(nal.length), nal]));
}
export function splitNALs(buffer: Buffer, ignorePartial?: "ignorePartial"): Buffer[] {
    let outputBuffers: Buffer[] = [];
    let i = 0;
    while (i < buffer.length) {
        let length = buffer.readUInt32BE(i);
        i += 4;
        if (i + length > buffer.length) {
            if (ignorePartial) break;
            let errorMessage = `NAL length is too long, buffer is corrupted. ${i} + ${length} = ${i + length} > ${buffer.length}`;
            console.error(errorMessage);
            break;
        }
        outputBuffers.push(buffer.slice(i, i + length));
        i += length;
    }
    return outputBuffers;
}

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
    let priority = obj.priority;
    let startTime = obj.startTime;
    let endTime = obj.endTime;
    let frames = obj.frames;
    let copy: VideoFileObjIn = { segmentTime, priority, startTime, endTime, frames };
    return "segment " + encodeFileObj(copy) + ".nal";
}
export function encodeVideoKeyPrefix(config: { segmentTime: number; priority: number }): string {
    // Must pad, so sorting by string works.
    return "segment " + encodeFileObj({
        segmentTime: config.segmentTime,
        priority: config.priority,
    });
}

export function isVideoFile(file: string) {
    return file.startsWith("segment ") && file.endsWith(".nal");
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
    fileObj.priority = +fileObj.priority;
    return fileObj;
}
export function getVideoStartTime(key: string): number {
    return parseVideoKey(key)?.startTime || 0;
}



export async function findVideo(time: number): Promise<string> {
    await getVideoIndexPromise();
    let file = findVideoBase(time);
    if (file) return file;
    await pollVideoFilesNow();
    return findVideoSync(time);
}
export function findVideoSync(time: number): string {
    let file = findVideoBase(time);
    if (file) return file;
    return getVideoIndexSynced().flatVideos.at(-1)?.file || "";
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
    if (!video) return undefined;
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
    let parsed = parseVideoKey(currentVideo);
    if (!parsed) return undefined;
    return parsed.frames / (parsed.endTime - parsed.startTime) * 1000;
}

const resetKeys = throttleFunction(1000, async () => {
    console.log("Resetting keys");
    FileStorageSynced.getAsync().resetKeys();
});