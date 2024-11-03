import { delay } from "socket-function/src/batching";
import os, { endianness } from "os";
import fs from "fs";
import { sort, timeInMinute } from "socket-function/src/misc";
import { formatDateTime, formatNumber, formatTime } from "socket-function/src/formatting/format";

import { IdentifyNal, SplitAnnexBVideo } from "mp4-typescript";
import { decodeVideoKey, encodeVideoKey, encodeVideoKeyPrefix, joinNALs } from "./videoHelpers";
import { getSpeed } from "./urlParams";

export const videoFolder = "/media/video/output/";

// NOTE: Only used for speed > 1 (otherwise we use 1 key frame per segment)
const TARGET_FRAMES_PER_SEGMENT = 30;
const BASE_ASSUMED_FRAME_TIME = 1000 / 30;
const PLAYBACK_TIME_PER_FOLDER = 100 * 1000;

type FrameVideoInput = {
    name: string;
    created: number;
    modified: number;
    nextCreated: number;
};
export async function getReadyVideos(): Promise<FrameVideoInput[]> {
    let files = await fs.promises.readdir(videoFolder);
    let toBeMoved = files.filter(x => x.startsWith("frames_"));

    let filesWithTimestamps: FrameVideoInput[] = [];
    for (let file of toBeMoved) {
        let stat = await fs.promises.stat(videoFolder + file);
        console.log(`File ${file} has created time ${formatDateTime(stat.ctimeMs)} and modified time ${formatDateTime(stat.mtimeMs)}`);
        filesWithTimestamps.push({
            name: file,
            // ntfs-3g is broken, and doesn't give birth time. But atime apparently is the same as it?
            created: stat.atimeMs,
            modified: stat.mtimeMs,
            nextCreated: 0,
        });
    }
    sort(filesWithTimestamps, x => x.created);
    for (let i = 0; i < filesWithTimestamps.length - 1; i++) {
        filesWithTimestamps[i].nextCreated = filesWithTimestamps[i + 1].created;
    }
    // The latest file is probably still being written to, so skip it.
    filesWithTimestamps.pop();
    return filesWithTimestamps;
}


// returns a path starting and ending with "/"
export async function emitFrames(config: {
    speedMultiplier: number;
    startTime: number;
    endTime: number;
    nals: Buffer[];
}) {
    let { speedMultiplier, startTime, endTime, nals } = config;
    let frames = nals.filter(x => IdentifyNal(x) === "frame" || IdentifyNal(x) === "keyframe").length;
    let timePerFrame = (endTime - startTime) / frames;

    let outputFolder = `${videoFolder}${speedMultiplier}x/`;

    let nextStartTime = startTime;
    for (let nalGroup of splitNalsIntoMinimumGroups(nals)) {
        let frameCount = nalGroup.filter(x => IdentifyNal(x) === "frame" || IdentifyNal(x) === "keyframe").length;
        let curDuration = frameCount * timePerFrame;
        let curStartTime = nextStartTime;
        let curEndTime = curStartTime + curDuration;
        nextStartTime = curEndTime;

        let segmentTime = curStartTime;
        if (speedMultiplier !== 1) {
            segmentTime = getSegmentTime({ speedMultiplier, time: curStartTime });
            nalGroup = getSingleFrame(nalGroup);
            frameCount = 1;
            curDuration = timePerFrame;
            curEndTime = curStartTime + curDuration;
        }

        let nalGroupSize = nalGroup.reduce((acc, x) => acc + x.length, 0);

        let fullPath = outputFolder + getTimeFolder({ time: curStartTime, speedMultiplier }) + encodeVideoKey({
            segmentTime: segmentTime,
            startTime: curStartTime,
            endTime: curEndTime,
            frames: frameCount,
            priority: 0,
            size: nalGroupSize,
        });
        let newPath = fullPath;
        // We only skip data at faster speeds
        if (speedMultiplier !== 1) {
            // NOTE: We already split into minimum groups, so the first frame is the
            //  most we can add (unless we add consective frames, but that would
            //  require NOT speeding up the video, which defeats the point of speeding
            //  up the video!)
            let curTimePerFrame = getSegmentDuration(speedMultiplier) / TARGET_FRAMES_PER_SEGMENT;
            // We want to add the frame a bit early, so we don't drop frames if the base video fluctuates a bit
            let minGap = curTimePerFrame * 0.999;

            let prefix = outputFolder + getTimeFolder({ time: curStartTime, speedMultiplier }) + encodeVideoKeyPrefix({
                segmentTime: segmentTime,
                priority: 0,
            });
            let existingSegment = await findFilePrefix(prefix);
            if (existingSegment) {
                fullPath = existingSegment;
                // IF we are too early, skip
                let decoded = decodeVideoKey(existingSegment);
                let curGap = curStartTime - decoded.endTime;
                // Skip it, it's too close to the previous frame
                if (curGap < minGap) continue;
                // NOTE: There is no maxGap. The files are so short that if it hits the same file, it's within 30 frames,
                //  and therefore, close enough to append to the same file.

                newPath = outputFolder + getTimeFolder({ time: curStartTime, speedMultiplier }) + encodeVideoKey({
                    segmentTime: segmentTime,
                    startTime: decoded.startTime,
                    endTime: curEndTime,
                    frames: decoded.frames + frameCount,
                    size: decoded.size + nalGroupSize,
                    priority: 0,
                });
            }
        }

        let dir = getDir(fullPath);
        await fs.promises.mkdir(dir, { recursive: true });
        await fs.promises.appendFile(fullPath, joinNALs(nalGroup));
        if (newPath !== fullPath) {
            //console.log(`Renaming ${fullPath} to ${newPath}`);
            await fs.promises.rename(fullPath, newPath);
        }
        console.log(`Wrote ${frameCount} frames to ${newPath}`);
    }
}

/** Gets the maximum time at which the dir will change. After this only
 *      deletions may occur, but never insertions.
 */
export function getDirMaximumChangeTime(dirPath: string) {
    let path = dirPath.split("/").slice(0, -1);
    path = path.filter(x => x.length === 1);
    if (path.length === 0) return +new Date("2100-01-01");
    let nums = path.map(x => parseInt(x));
    if (nums.length < 13) {
        // Pad with 9s, to give the maximum possible child time
        nums = nums.concat(Array(13 - nums.length).fill(9));
    }
    let time = 0;
    let curFactor = 10 ** 12;
    for (let num of nums) {
        time += num * curFactor;
        curFactor /= 10;
    }
    if (time < +new Date("2000-01-01") || time > +new Date("2100-01-01")) {
        throw new Error(`Invalid time dir path: ${dirPath}`);
    }
    return time;
}

function getDir(path: string) {
    return path.split("/").slice(0, -1).join("/") + "/";
}

// Each group has a keyframe, dependent frames, an sps, and a pps.
//  - Might have to duplicate nals to ensure every group has an sps and pps.
//  - Throws if there is no sps or pps in the data (or if it doesn't start with a keyframe)
function splitNalsIntoMinimumGroups(nals: Buffer[]): Buffer[][] {
    let anySPS = nals.find(x => IdentifyNal(x) === "sps");
    let anyPPS = nals.find(x => IdentifyNal(x) === "pps");
    if (!anySPS) throw new Error("No sps found");
    if (!anyPPS) throw new Error("No pps found");

    let groups: Buffer[][] = [];
    for (let i = 0; i < nals.length; i++) {
        let nal = nals[i];
        if (IdentifyNal(nal) === "keyframe") {
            // Preferrable the SPS is before, but... if it's after it'll probably work too..
            let sps = anySPS;
            for (let j = i - 1; j >= 0; j--) {
                if (IdentifyNal(nals[j]) === "sps") {
                    sps = nals[j];
                    break;
                }
            }
            let pps = anyPPS;
            for (let j = i - 1; j >= 0; j--) {
                if (IdentifyNal(nals[j]) === "pps") {
                    pps = nals[j];
                    break;
                }
            }
            let nextKeyFrameIndex = nals.length;
            for (let j = i + 1; j < nals.length; j++) {
                if (IdentifyNal(nals[j]) === "keyframe") {
                    nextKeyFrameIndex = j;
                    break;
                }
            }
            // NOTE: We filter out access units here. If we can get away without them, we shouldn't
            //  add them. More data will only break things.
            let dependentFrames = nals.slice(i + 1, nextKeyFrameIndex).filter(x => IdentifyNal(x) === "frame");
            groups.push([sps, pps, nal, ...dependentFrames]);
        }
    }
    return groups;
}
// The minimum possible frames (which might still be multiple nals, as the sps and pps are needed)
function getSingleFrame(nals: Buffer[]): Buffer[] {
    if (nals.length < 3) throw new Error(`Unexpected NAL count in group: ${nals.length} < 3`);
    if (IdentifyNal(nals[0]) !== "sps") throw new Error(`Unexpected NOT SPS in group at index 0: ${IdentifyNal(nals[0])}`);
    if (IdentifyNal(nals[1]) !== "pps") throw new Error(`Unexpected NOT PPS in group at index 1: ${IdentifyNal(nals[1])}`);
    if (IdentifyNal(nals[2]) !== "keyframe") throw new Error(`Unexpected NOT keyframe in group at index 2: ${IdentifyNal(nals[2])}`);
    return nals.slice(0, 3);
}

function getSegmentDuration(speedMultiplier: number) {
    return TARGET_FRAMES_PER_SEGMENT * BASE_ASSUMED_FRAME_TIME * speedMultiplier;
}

function getSegmentTime(config: {
    speedMultiplier: number;
    time: number;
}): number {
    let duration = getSegmentDuration(config.speedMultiplier);
    return Math.floor(config.time / duration) * duration;
}
// Just the folder, ex, "0/1/2/"
export function getTimeFolder(config: {
    time: number;
    speedMultiplier: number;
}): string {
    let time = config.time;
    let perFolder = PLAYBACK_TIME_PER_FOLDER * config.speedMultiplier;
    let rounded = (Math.ceil(time / perFolder) + 1) * perFolder;
    let folder = Array.from(rounded.toString()).join("/") + "/";
    while (folder.endsWith("/0/")) {
        folder = folder.slice(0, -"0/".length);
    }
    return folder;
}

// Finds the first file with this prefix (duplicates are broken by a string sort).
async function findFilePrefix(fullPathPrefix: string): Promise<string | undefined> {
    let dir = getDir(fullPathPrefix);
    let fileName = fullPathPrefix.split("/").slice(-1)[0];
    try {
        let files = await fs.promises.readdir(dir);
        files = files.filter(x => x.startsWith(fileName));
        files.sort();
        if (files.length > 1) {
            console.warn(`Multiple files with prefix (${files.length}): ${fullPathPrefix}`);
        }
        if (files.length === 0) return undefined;
        return dir + files[0];
    } catch {
        return undefined;
    }
}