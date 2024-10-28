import { delay, runInfinitePoll } from "socket-function/src/batching";
import os, { endianness } from "os";
import fs from "fs";
import { sort, timeInMinute, timeInSecond } from "socket-function/src/misc";
import { formatNumber, formatTime } from "socket-function/src/formatting/format";

import { IdentifyNal, SplitAnnexBVideo } from "mp4-typescript";
import { decodeVideoKey, encodeVideoKey, joinNALs, parseVideoKey } from "./videoHelpers";
import { getReadyVideos, emitFrames, videoFolder } from "./frameEmitHelpers";


// NOTE: For anything but 1, we split into keyframes. SO, if there is a keyframe every 30 frames,
//  we will sample at most 1 out of every 30 frames, making the minimum speed 30x.
let speedGroups = [1, 60, 60 * 60, 60 * 60 * 24, 60 * 60 * 24 * 14];
const MAX_DISK_USAGE = 1024 * 1024 * 1024 * 200;

let moveFileDropCount = 0;

async function moveFiles() {
    let filesWithTimestamps = await getReadyVideos();
    if (filesWithTimestamps.length === 0) return;

    //console.log(`Found ${filesWithTimestamps.length} files to move at ${new Date().toISOString()}`);
    let time = Date.now();
    for (let file of filesWithTimestamps) {
        let endTime = file.modified;

        // The the next file creation is within a few seconds, use it as our endTime, to
        //  be a little more accurate (otherwise we don't count overhead time)
        if (file.nextCreated < file.modified + 10000) {
            endTime = file.nextCreated;
        }

        let buffer = await fs.promises.readFile(videoFolder + file.name);

        let nals = SplitAnnexBVideo(buffer);
        console.log(`Processing ${file.name} with ${nals.filter(x => IdentifyNal(x) === "frame" || IdentifyNal(x) === "keyframe").length} frames`);
        for (let speedMultiplier of speedGroups) {
            try {
                await emitFrames({
                    speedMultiplier,
                    startTime: file.created,
                    endTime,
                    nals: nals,
                });
            } catch (e) {
                moveFileDropCount++;
                console.error(`Error processing ${file.name} at speed ${speedMultiplier}, deleting file, so we can continue processing data`, e);
            }
        }
        await fs.promises.unlink(videoFolder + file.name);
    }
    console.log("Processed", filesWithTimestamps.length, "files in", formatTime(Date.now() - time), "at", new Date().toISOString());
    console.log(" ");
    if (moveFileDropCount) {
        console.log(`Dropped ${moveFileDropCount} files so far this session`);
    }
}

async function safeReadDir(folder: string) {
    try {
        return await fs.promises.readdir(folder);
    } catch (e) {
        console.error("Error reading directory, skipping", folder, e);
        return [];
    }
}
async function safeStat(file: string) {
    try {
        return await fs.promises.stat(file);
    } catch (e) {
        console.error("Error stating file, skipping", file, e);
        return undefined;
    }
}

async function* recursiveIterate(folder: string): AsyncGenerator<{
    path: string;
    size: number;
}> {
    let files = await safeReadDir(folder);
    for (let file of files) {
        let stat = await safeStat(folder + file);
        if (!stat) continue;
        if (stat.isDirectory()) {
            yield* recursiveIterate(folder + file + "/");
        } else {
            yield {
                path: folder + file,
                size: stat.size,
            };
        }
    }
}
async function safeUnlink(file: string) {
    try {
        return await fs.promises.unlink(file);
    } catch (e) {
        console.error("Error unlinking file, skipping", file, e);
    }
}

async function limitFiles() {
    let speedFolders = await fs.promises.readdir(videoFolder);
    speedFolders = speedFolders.filter(x => x.endsWith("x") && !isNaN(+x.slice(0, -1)));
    sort(speedFolders, x => -x.slice(0, -1));

    let deletedFiles = 0;
    let deletedBytes = 0;

    let time = Date.now();
    let sizePerSpeed = MAX_DISK_USAGE / speedFolders.length;
    let remainingSpeedFolders = speedFolders.length;
    for (let speedFolder of speedFolders) {
        remainingSpeedFolders--;
        let allFiles: { path: string; size: number; startTime: number; }[] = [];
        for await (let file of recursiveIterate(videoFolder + speedFolder + "/")) {
            let obj = decodeVideoKey(file.path);
            if (!obj.startTime) continue;
            allFiles.push({ path: file.path, size: file.size, startTime: obj.startTime });

            // NOTE: If we run into any issues with lagging the disk, we could add a delay here to slow down iteration
        }
        sort(allFiles, x => x.startTime);

        let totalSize = allFiles.reduce((acc, x) => acc + x.size, 0);
        let excessSize = totalSize - sizePerSpeed;
        let filesToRemove: string[] = [];
        while (excessSize > 0) {
            let file = allFiles.pop();
            if (!file) break;
            excessSize -= file.size;
            deletedFiles++;
            deletedBytes += file.size;
            filesToRemove.push(file.path);
        }
        for (let file of filesToRemove) {
            await safeUnlink(file);
        }
        if (excessSize < 0) {
            sizePerSpeed += excessSize / remainingSpeedFolders;
        }
    }

    let totalTime = Date.now() - time;
    if (deletedFiles > 0) {
        console.log(`Limited files in ${formatTime(totalTime)}, deleted ${deletedFiles} files, ${formatNumber(deletedBytes)}B`);
    }
}

async function main() {
    runInfinitePoll(timeInSecond, moveFiles);
    runInfinitePoll(timeInMinute * 15, limitFiles);
}
main().catch(e => console.error(e));