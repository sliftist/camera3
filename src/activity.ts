import fs from "fs";
import { H264toMP4 } from "mp4-typescript";
import { binarySearchBasic, sort, timeInHour, timeInMinute, timeInSecond } from "socket-function/src/misc";
import { splitNALs } from "./videoBase";
import child_process from "child_process";
import { getDirMaximumChangeTime, getFolderSpeed, getTimeFolder } from "./frameEmitHelpers";
import { recursiveIterate } from "./readHelpers";
import { isVideoFile, parseVideoKey, VideoFileObj } from "./videoHelpers";
import { formatDateTime, formatTime } from "socket-function/src/formatting/format";
import { delay, runInfinitePollCallAtStart } from "socket-function/src/batching";
import { jpegSuffixes } from "./constants";
import { cache } from "socket-function/src/caching";

const rootDir = "/media/video/output/";

const CHANGE_PIXEL_THRESHOLD = 200;
const BASE_VIDEO_BUFFER_TIME = 10 * 1000;

// Returns pixels changed for each frame. The first frame necessarily
//  has to be 0, because it is the baseline.
async function getVideoActivityBase(path: string): Promise<number[]> {
    let buffer = await fs.promises.readFile(path);
    let nals = splitNALs(buffer, "ignorePartial");
    if (nals.length === 0) {
        console.error(`No NALs found in video: ${path}`);
        return [];
    }
    let { buffer: mp4Buffer, frameCount, keyFrameCount } = await H264toMP4({
        buffer: nals,
        frameDurationInSeconds: 1 / 30,
        mediaStartTimeSeconds: 0,
    });
    const tempPath = "/media/video/temp.mp4";
    await fs.promises.writeFile(tempPath, mp4Buffer);

    let result = child_process.execSync(`python /home/quent/camera3/src/activity.py ${tempPath} ${CHANGE_PIXEL_THRESHOLD} ${JSON.stringify(path)}`);
    let resultStr = result.toString();
    let obj = JSON.parse(resultStr) as number[];
    return obj;
}
async function getVideoActivity(path: string): Promise<boolean> {
    try {
        let obj = await getVideoActivityBase(path);
        if (obj.length === 0) {
            console.warn(`No frames found in video, assuming there is no activity`, path);
            return false;
        }
        if (!Array.isArray(obj)) {
            throw new Error(`Expected array, got ${JSON.stringify(obj)}`);
        }
        // 200 pixels changed is almost nothing
        let maxPixels = Math.max(...obj);
        console.log(`Activity pixels ${maxPixels}`);
        return maxPixels > CHANGE_PIXEL_THRESHOLD;
    } catch (e) {
        console.error(`Error getting activity, pretending the video has activity`, path, e);
        return true;
    }
}

async function deleteStaticVideo1x() {
    let activityRangesRaw: { start: number; end: number; path: string; }[] = [];
    for await (let { path, size } of recursiveIterate(rootDir + "60x/")) {
        if (!isVideoFile(path)) continue;
        let obj = parseVideoKey(path);
        if (!obj.startTime) continue;
        activityRangesRaw.push({ start: obj.startTime, end: obj.endTime, path });
    }
    sort(activityRangesRaw, x => x.start);
    console.log(`Found ${activityRangesRaw.length} activity ranges`);

    let copiedPreviews = 0;

    async function hasActivity(range: { start: number; end: number; path: string; }) {
        let index = binarySearchBasic(activityRangesRaw, x => x.start, range.start);
        if (index < 0) index = ~index - 1;
        if (index < 0) index = 0;
        while (index < activityRangesRaw.length) {
            let activityRange = activityRangesRaw[index];
            // Ranges only increase in start time, so if the current is after us,
            //  all will be after us
            if (activityRange.start >= range.end) return false;
            // If it isn't after us, and isn't before us (end < start), then it must overlap
            if (activityRange.end > range.start) {
                // Copy previews, so we have them for 1x video
                for (let { suffix } of jpegSuffixes) {
                    let previewPath = range.path + suffix;
                    let previewPathNew = activityRange.path + suffix;
                    // Only copy if it doesn't exist
                    try {
                        await fs.promises.access(previewPathNew);
                    } catch {
                        try {
                            await fs.promises.copyFile(previewPath, previewPathNew);
                            try {
                                await fs.promises.copyFile(previewPath + ".metadata", previewPathNew + ".metadata");
                            } catch { }
                            copiedPreviews++;
                        } catch (e) {
                            console.error(`Error copying preview: ${previewPath} to ${previewPathNew}`, e);
                        }
                    }
                }
                return true;
            }
            index++;
        }
        // If we are beyond all activity, we MIGHT have activity, so best keep the file
        return true;
    }

    let startIterationTime = Date.now();

    let activityCount = 0;
    let staticCount = 0;
    for await (let { path, size } of recursiveIterate(rootDir + "1x/")) {
        if (!isVideoFile(path)) continue;
        let obj = parseVideoKey(path);
        if (!obj.startTime) continue;
        let range = { start: obj.startTime - BASE_VIDEO_BUFFER_TIME, end: obj.endTime + BASE_VIDEO_BUFFER_TIME, path };
        if (!await hasActivity(range)) {
            staticCount++;
            await fs.promises.unlink(path);
        } else {
            activityCount++;
        }
    }

    let totalTime = Date.now() - startIterationTime;

    console.log(`${new Date().toISOString()}   Finished deleting static videos for ${1}x in ${formatTime(totalTime)}. Active: ${activityCount}, Static: ${staticCount}, Copied previews: ${copiedPreviews}`);
}

async function deleteStaticVideo(speed: number) {
    if (speed === 1) {
        await deleteStaticVideo1x();
        return;
    }

    // NOTE: We want to be REALLY smart with iteration here, as getVideoActivity is SLOW! (500ms per frame)
    //  (Elsewhere, such as in 1x, and in limit.ts, it's fine to be slower).
    const root = `${rootDir}${speed}x/`;
    const timePath = root + `lastActivityProcessed5.txt`;
    let minTime = 0;
    try {
        let timeStr = await fs.promises.readFile(timePath, "utf8");
        minTime = +timeStr;
    } catch { }

    console.log(`Starting to delete static videos for ${speed}x, starting from ${formatDateTime(minTime)}`);

    let startIterationTime = Date.now();

    let lastReadTime = 0;
    let activityCount = 0;
    let staticCount = 0;

    let getOldestVideo = cache((paths: string[]): string => {
        paths = paths.filter(isVideoFile);
        let objs = paths.map(x => ({ file: x, obj: parseVideoKey(x) })).filter(x => x.obj.startTime);
        sort(objs, x => -x.obj.startTime);
        return objs[0]?.file;
    });

    for await (let { path, size, paths } of recursiveIterate(root, minTime)) {
        if (!isVideoFile(path)) continue;
        let obj = parseVideoKey(path);
        if (!obj.startTime) continue;

        let maxChangeTime = getDirMaximumChangeTime(path);
        if (maxChangeTime > startIterationTime) {
            // ALTHOUGH, if there are already videos older than it, it probably won't change,
            //  so... parse it now. This is useful for generating previews.
            if (getOldestVideo(paths) === path) {
                continue;
            }
        }

        try {
            let stat = await fs.promises.stat(path);
            lastReadTime = Math.max(lastReadTime, stat.mtimeMs);

            let time = Date.now();
            let hasActivity = await getVideoActivity(path);
            time = Date.now() - time;
            let age = formatTime(Date.now() - stat.mtimeMs);
            if (!hasActivity) {
                staticCount++;
                console.log(`Deleting static video ${age} old, took ${formatTime(time)}:   ${path}`);
                await fs.promises.unlink(path);
            } else {
                console.log(`Keeping activity ${age} old, took ${formatTime(time)}:   ${path}`);
                activityCount++;
            }

        } catch (e) {
            console.error("Error stating file, skipping", path, e);
        }
    }

    await fs.promises.writeFile(timePath, lastReadTime + "");

    let totalTime = Date.now() - startIterationTime;

    console.log(`${new Date().toISOString()}   Finished deleting static videos for ${speed}x in ${formatTime(totalTime)}. Active: ${activityCount}, Static: ${staticCount}`);
}

async function iterateOnce() {
    let speedDirs = await fs.promises.readdir(rootDir);
    let speeds = speedDirs.filter(x => x.endsWith("x")).map(x => +x.slice(0, -1)).filter(x => !isNaN(x));
    sort(speeds, x => -x);
    for (let speed of speeds) {
        await deleteStaticVideo(speed);
    }
}

async function main() {
    await runInfinitePollCallAtStart(timeInMinute * 10, iterateOnce);

    // child_process.execSync(`python /home/quent/camera3/src/activity.py /home/quent/dynamic.mp4 ${CHANGE_PIXEL_THRESHOLD} /home/quent/pretend.nal`);

    // console.log("Done");
    // await delay(timeInHour);
}

main().catch(console.error);