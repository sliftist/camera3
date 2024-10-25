import preact from "preact";
import { observer } from "./misc/observer";
import { VideoManager } from "./VideoManager";
import { URLParamStr } from "./misc/URLParam";
import { css } from "typesafecss";
import { observable } from "./misc/mobxTyped";
import { getThumbnailURL } from "./thumbnail";
import { getFileStorage } from "./storage/FileFolderAPI";
import { getLiveVideos } from "./videoHelpers";
import { formatNumber, formatTime } from "socket-function/src/formatting/format";
import { DiskCollectionRaw } from "./storage/DiskCollection";

const incrementType = new URLParamStr("inc");

let test = new DiskCollectionRaw("test");

@observer
export class VideoGrid extends preact.Component<{
    videoManager: VideoManager;
}> {
    synced = observable({
        //expanded: false,
    });
    render() {
        let videoManager = this.props.videoManager;
        let state = videoManager.state;
        let inc: IncrementType = incrementType.value as any || "day";
        let subRanges = getIncrementSubRanges(state.curPlayingTime, inc);

        let videos = getLiveVideos();
        type Video = typeof videos[0];
        let videoLookup = new Map<unknown, Video[]>();
        let videoIndex = 0;
        for (let subRange of subRanges.ranges) {
            let matchingVideos: Video[] = [];
            while (videoIndex < videos.length) {
                let video = videos[videoIndex];
                if (video.time > subRange.end) break;
                if (video.endTime < subRange.start) {
                    videoIndex++;
                    continue;
                }
                matchingVideos.push(video);
                videoIndex++;
            }
            videoLookup.set(subRange, matchingVideos);
        }

        /*
        todonext
        - Overview control
            - Rendered as preview buttons above video AND THEN clicking expands it
            - Render at the real aspect ratio
            - Copy the video-player thumbnail cache function
            - Preview shows various times in the past (past hour, past day, etc)
                - Put the text over the thumbnail, as the text is the most important, and the thumbnail probably won't be useful right now (as it'll always be the same)
            - Each thumbnail links to the start of that period
            - Main grid is just thumbnail
                - Tightly fitting, via measuring our size with a div measurer
            - Clicking on thumbnail plays it, and closes the overview
                - Buttons underneath
                    - Zoom in
                    - Play (but not close overview)
            - Click on large buttons on either side to go forward or back (not adding video, just jumping time periods)
            - Button to close it (back down to preview)
            - Button to zoom out (keeping the video centered)
            - Indicate if the current time is in a block OR before/after
            - Button to go to the present
            - Indicator on either side which time we are playing live, and the present
        */

        return (
            <div className={css.vbox(10).pad2(10)}>
                <button onClick={async () => {
                    let data = Buffer.alloc(1024 * 10);
                    for (let i = 0; i < data.length; i++) {
                        data[i] = Math.random() * 256;
                    }
                    await test.set("test", data);

                    /*
                    //todonext
                    //  I fixed the FS issues. So... we SHOULD be able to use getThumbnailURL again... maybe?

                    let fileStorage = await getFileStorage();
                    // let handle = await fileStorage.folder.getNestedFileHandle(["test", "newfile3"], "create");
                    // if (!handle) throw new Error("Handle not found");
                    // // Write using handle
                    // let writable = await handle.createWritable();
                    // await writable.write("test" + Date.now());
                    // await writable.close();


                    // Test getNestedFileHandle with creating folders


                    let homeFolder = await fileStorage.folder.getStorage("test");
                    //await homeFolder.set("newfile", Buffer.from("test" + Date.now()));
                    await homeFolder.append("test2.txt", Buffer.from("test" + Date.now()));
                    */

                    //todonext
                    //  Write's aren't supported
                    //await testDir.set("test.txt", Buffer.from("test"));
                    //await testDir.append("test.txt", Buffer.from("test"));
                }}>
                    test
                </button>
                <div>
                    <select value={inc} onChange={e => incrementType.value = e.currentTarget.value as any}>
                        {renderIncrements.map(inc => <option value={inc}>{inc}</option>)}
                    </select>
                </div>
                <div>
                    {subRanges.mainTitle}
                    <div className={css.hbox(10).wrap}>
                        {subRanges.ranges.slice(-1).map(range => {
                            let thumb = getThumbnailURL({ time: range.start, maxDimension: 200, retryErrors: true });
                            return (
                                <div className={css.size(160, 160).vbox0.bord(1, "white").relative}>
                                    {thumb.startsWith("data:") &&
                                        <img
                                            className={css.pos(0, 0).fillBoth.absolute.objectFit("cover")}
                                            src={thumb}
                                        /> || undefined
                                    }
                                    <div className={css.vbox(4).hsla(0, 0, 20, 0.5).pad2(4).relative}>
                                        {formatFullIncrement(range.start, incrementSubs[inc].subType)}
                                        <span>{formatNumber(videoLookup.get(range)?.length)} segments</span>
                                        <span>{formatNumber(videoLookup.get(range)?.map(x => x.frames).reduce((a, b) => a + b, 0))} frames</span>
                                        <span>{formatTime(videoLookup.get(range)?.map(x => x.endTime - x.time).reduce((a, b) => a + b, 0))}</span>
                                        todonext;
                                    // Show green highlight bar on top for % of time filled, and right align time, and remove the rest of the text
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        );
    }
}

type IncrementType = "second" | "minute" | "minute2" | "hour" | "hour6" | "day" | "week" | "week2" | "month" | "year";
let renderIncrements: IncrementType[] = ["second", "minute", "hour", "day", "week", "month", "year"];
let incrementSubs: {
    [key in IncrementType]: { type: IncrementType; subType: IncrementType; }
} = {
    second: { type: "second", subType: "second" },
    minute: { type: "minute", subType: "second" },
    minute2: { type: "minute2", subType: "second" },
    hour: { type: "hour", subType: "minute" },
    hour6: { type: "hour6", subType: "hour" },
    day: { type: "day", subType: "hour" },
    week: { type: "week", subType: "hour6" },
    week2: { type: "week2", subType: "day" },
    month: { type: "month", subType: "day" },
    year: { type: "year", subType: "week2" },
};
function getStartOfIncrement(time: number, type: IncrementType): number {
    let d = new Date(time);
    if (type === "second") {
        d.setMilliseconds(0);
    } else if (type === "minute") {
        d.setSeconds(0);
        d.setMilliseconds(0);
    } else if (type === "minute2") {
        d.setSeconds(0);
        d.setMilliseconds(0);
        // Round to nearest 2 minutes
        let minutes = d.getMinutes();
        let half = minutes % 2 === 1;
        if (half) {
            d.setMinutes(minutes - 1);
        }
    } else if (type === "hour") {
        d.setMinutes(0);
        d.setSeconds(0);
        d.setMilliseconds(0);
    } else if (type === "hour6") {
        d.setHours((d.getHours() / 6) * 6);
        d.setMinutes(0);
        d.setSeconds(0);
        d.setMilliseconds(0);
    } else if (type === "day") {
        d.setHours(0);
        d.setMinutes(0);
        d.setSeconds(0);
        d.setMilliseconds(0);
    } else if (type === "week") {
        d.setHours(0);
        d.setMinutes(0);
        d.setSeconds(0);
        d.setMilliseconds(0);
        d.setDate(d.getDate() - d.getDay());
    } else if (type === "week2") {
        // Only land on even weeks, numbering weeks from the epoch
        let epoch = new Date(0);
        let epochWeek = Math.floor(epoch.getTime() / (86400000 * 7));
        let week = Math.floor(d.getTime() / (86400000 * 7));
        let diff = week - epochWeek;
        let even = diff % 2 === 0;
        if (!even) diff++;
        d.setTime(epochWeek + diff * 86400000 * 7);
        d.setHours(0);
        d.setMinutes(0);
        d.setSeconds(0);
        d.setMilliseconds(0);
    } else if (type === "month") {
        d.setHours(0);
        d.setMinutes(0);
        d.setSeconds(0);
        d.setMilliseconds(0);
        d.setDate(1);
    } else if (type === "year") {
        d.setHours(0);
        d.setMinutes(0);
        d.setSeconds(0);
        d.setMilliseconds(0);
        d.setMonth(0);
        d.setDate(1);
    }
    return d.getTime();
}
function incrementMedianSize(type: IncrementType): number {
    if (type === "second") return 1000;
    if (type === "minute") return 60000;
    if (type === "minute2") return 60000 * 2;
    if (type === "hour") return 3600000;
    if (type === "hour6") return 3600000 * 6;
    if (type === "day") return 86400000;
    if (type === "week") return 86400000 * 7;
    if (type === "week2") return 86400000 * 14;
    if (type === "month") return 86400000 * 30;
    if (type === "year") return 86400000 * 365;
    let unhandled: never = type;
    throw new Error("Unhandled type: " + unhandled);
}
function getNextIncrement(time: number, type: IncrementType): number {
    time = getStartOfIncrement(time, type);
    time += incrementMedianSize(type) * 1.5;
    return getStartOfIncrement(time, type);
}
function hourMinuteSecond(time: number): string {
    // 12:00:00 PM
    let d = new Date(time);
    let hours = d.getHours();
    let minutes = d.getMinutes();
    let seconds = d.getSeconds();
    let ampm = hours < 12 ? "AM" : "PM";
    hours = hours % 12;
    if (hours === 0) hours = 12;
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")} ${ampm}`;
}
function formatSingleIncrement(time: number, type: IncrementType): string {
    time = getStartOfIncrement(time, type);
    let d = new Date(time);
    function p(x: number) { return x.toString().padEnd(2, "0"); }
    if (type === "second") return hourMinuteSecond(time);
    if (type === "minute") return hourMinuteSecond(time);
    if (type === "minute2") return formatSingleIncrement(time, "minute");
    if (type === "hour") return hourMinuteSecond(time);
    if (type === "hour6") return formatSingleIncrement(time, "hour");
    if (type === "day") return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()] + " " + d.getDate();
    // Month - Day
    if (type === "week") return formatFullIncrement(time, "month") + " " + formatSingleIncrement(time, "day");
    if (type === "week2") return formatSingleIncrement(time, "week");
    if (type === "month") return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
    if (type === "year") return d.getFullYear() + "";
    let unhandled: never = type;
    throw new Error("Unhandled type: " + unhandled);
}
function formatFullIncrement(time: number, type: IncrementType): string {
    let fullFormat = [
        hourMinuteSecond(time),
        formatSingleIncrement(time, "day"),
        formatSingleIncrement(time, "month"),
        formatSingleIncrement(time, "year"),
    ];
    let count = fullFormat.length;
    if (type === "second") count = 1;
    if (type === "minute") count = 1;
    if (type === "minute2") count = 1;
    if (type === "hour") count = 1;
    if (type === "hour6") count = 1;
    if (type === "day") count = 2;
    if (type === "week") count = 3;
    if (type === "month") count = 3;
    if (type === "year") count = 4;
    return fullFormat.slice(0, count).join(" ");
}
function getIncrementSubRanges(time: number, type: IncrementType): {
    mainTitle: string;
    ranges: {
        start: number;
        end: number;
        title: string;
    }[];
} {
    let subType = incrementSubs[type].subType;
    let start = getStartOfIncrement(time, type);
    let end = getNextIncrement(time, type);
    let cur = start;
    let ranges: { start: number; end: number; title: string; }[] = [];
    while (true) {
        let next = getNextIncrement(cur, subType);
        ranges.push({ start: cur, end: next, title: formatSingleIncrement(cur, subType) });
        cur = next;
        if (cur >= end) break;
    }
    return {
        mainTitle: formatFullIncrement(start, type),
        ranges,
    };
}