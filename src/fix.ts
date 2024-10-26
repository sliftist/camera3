import { delay } from "socket-function/src/batching";
import os, { endianness } from "os";
import fs from "fs";
import { sort, timeInMinute } from "socket-function/src/misc";
import { formatNumber, formatTime } from "socket-function/src/formatting/format";

import { ConvertAnnexBToRawBuffers } from "mp4-typescript/src/parser-implementations/NAL";
import { LargeBuffer } from "mp4-typescript/src/parser-lib/LargeBuffer";
import * as NAL from "mp4-typescript/src/parser-implementations/NAL";

const videoFolder = "/media/video/output/";

async function moveFiles() {
    let files = await fs.promises.readdir(videoFolder);
    let toBeMoved = files.filter(x => x.startsWith("frames_"));

    let filesWithTimestamps: {
        name: string;
        created: number;
        modified: number;
        nextCreated: number;
    }[] = [];
    for (let file of toBeMoved) {
        let stat = await fs.promises.stat(videoFolder + file);
        filesWithTimestamps.push({
            name: file,
            created: stat.birthtimeMs,
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
    if (filesWithTimestamps.length === 0) return;

    console.log(`Found ${filesWithTimestamps.length} files to move at ${new Date().toISOString()}`);
    let time = Date.now();
    for (let file of filesWithTimestamps) {

        let endTime = file.modified;

        // The the next file creation is within 2 seconds, use it as our endTime, to
        //  be a little more accurate (otherwise we don't count overhead time)
        if (file.nextCreated < file.modified + 2000) {
            endTime = file.nextCreated;
        }


        let buffer = await fs.promises.readFile(videoFolder + file.name);
        let buffers = ConvertAnnexBToRawBuffers(new LargeBuffer([buffer]));
        let frames = 0;
        for (let buffer of buffers) {
            let parsed = NAL.ParseNalHeaderByte2(buffer.readUInt8(0));
            if (parsed === "frame" || parsed === "keyframe") {
                frames++;
            }
        }

        let p = (x: number) => x.toString().padStart(2, "0");
        let date = new Date(file.created);
        let newFile = `segment_${date.getUTCFullYear()}_${p(date.getUTCMonth())}_${p(date.getUTCDate())}__${p(date.getUTCHours())}_${p(date.getUTCMinutes())}_${p(date.getUTCSeconds())}__frames_${frames}__end_${endTime}.nal`;

        await fs.promises.rename(videoFolder + file.name, videoFolder + newFile);
    }
    console.log("Moved", filesWithTimestamps.length, "files in", formatTime(Date.now() - time));
}
async function limitFiles() {
    let files = await fs.promises.readdir(videoFolder);
    let moved = files.filter(x => x.startsWith("segment_"));
    moved.sort();

    moved.reverse();

    // It's a 256GB USB stick. We'll run into file count issues (making readDir unbearably slow)
    //  before we run out of space.
    let availableSpace = 1024 * 1024 * 1024 * 100;
    let deleted = 0;
    for (let file of moved) {
        let stat = await fs.promises.stat(videoFolder + file);
        availableSpace -= stat.size;
        if (availableSpace < 0) {
            await fs.promises.unlink(videoFolder + file);
            availableSpace += stat.size;
            deleted++;
        }
    }
    if (deleted > 0) {
        console.log(`Deleted ${deleted} files to free up space`);
    } else {
        console.log(`Space available: ${formatNumber(availableSpace)}B`);
    }

}

async function main() {
    while (true) {
        try {
            await moveFiles();
        } catch (e) {
            console.error(e);
        }
        try {
            await limitFiles();
        } catch (e) {
            console.error(e);
        }
        await delay(1000 * 5);
    }
}
main().catch(e => console.error(e)).finally(() => process.exit());