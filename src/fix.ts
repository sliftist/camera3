import { runInfinitePoll } from "socket-function/src/batching";
import fs from "fs";
import { timeInSecond } from "socket-function/src/misc";
import { formatTime } from "socket-function/src/formatting/format";

import { IdentifyNal, SplitAnnexBVideo } from "mp4-typescript";
import { getReadyVideos, emitFrames, videoFolder } from "./frameEmitHelpers";
import { speedGroups } from "./constants";


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

async function main() {
    runInfinitePoll(timeInSecond, moveFiles);
}
main().catch(e => console.error(e));