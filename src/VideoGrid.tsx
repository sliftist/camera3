import preact from "preact";
import { observer } from "./misc/observer";
import { VideoManager } from "./VideoManager";
import { URLParamStr } from "./misc/URLParam";
import { css } from "typesafecss";
import { observable } from "./misc/mobxTyped";
import { getThumbnailURL } from "./thumbnail";
import { getFileStorage } from "./storage/FileFolderAPI";
import { formatNumber, formatTime } from "socket-function/src/formatting/format";
import { DiskCollectionRaw } from "./storage/DiskCollection";
import { Button } from "./Button";
import { binarySearchBasic, list } from "socket-function/src/misc";
import { Icon } from "./icons";
import { getVideoIndexSynced } from "./videoLookup";
import { getTimeFolder } from "./frameEmitHelpers";
import { getSpeed } from "./urlParams";
import { filterToRange, getThumbnailRange } from "./videoHelpers";

const incrementTypeURL = new URLParamStr("inc");
const gridSizeURL = new URLParamStr("gridSize");

@observer
export class VideoGrid extends preact.Component<{
    videoManager: VideoManager;
    defaultIncrement?: IncrementType;
}> {
    synced = observable({
        expanded: false,
        viewTime: 0,
    });
    render() {
        let gridSize = +gridSizeURL.value || 200;

        let videoManager = this.props.videoManager;
        let state = videoManager.state;
        let currentIncrement: IncrementType = (
            incrementTypeURL.value as any
            || this.props.defaultIncrement
            || "day"
        );
        let subIncrement = incrementSubs[currentIncrement].subType;
        let currentTime = this.synced.viewTime || state.targetTime;
        let subRanges = getIncrementSubRanges(currentTime, currentIncrement);

        function getRangeData(range: { start: number; end: number }) {
            let index = getVideoIndexSynced();
            let curRanges = filterToRange(index.ranges, range);
            let ranges = curRanges.map(x => ({
                time: Math.max(range.start, x.startTime),
                endTime: Math.min(range.end, x.endTime),
                base: x
            }));
            let thumb = getThumbnailRange(gridSize, range);
            return { thumb, ranges, thumbIsGood: thumb.startsWith("data:") };
        }

        if (!this.synced.expanded) {
            return (
                <div
                    className={
                        css.fillWidth.hbox(20).height(28).center.relative.pad2(4)
                            .hsl(0, 0, 20)
                            .button
                    }
                    onClick={() => this.synced.expanded = true}
                >
                    {Icon.chevronDoubleUp()}
                </div>
            );
        }

        return (
            <div className={css.vbox(10).pad2(10).margins2(10).width(`calc(100% - 20px)`).hsl(0, 0, 10).minHeight(0)}>
                <div className={css.hbox(20).fillWidth.minHeight(0)}>
                    <div
                        className={
                            css.size(50, "100%").center
                                .vbox(10)
                                .textAlign("center")
                                .hsl(0, 0, 5).background("hsl(0, 0%, 15%)", "hover", "important")
                                .pointer
                                .colorhsl(0, 0, 70)
                                .pad2(0, 10)
                        }
                        onClick={() => this.synced.viewTime = getPrevIncrement(currentTime, currentIncrement)}
                    >
                        {Icon.chevronDoubleLeft()}
                        <div className={css.marginAuto} />
                        {formatSingleIncrement(getPrevIncrement(currentTime, currentIncrement), currentIncrement)}
                        <div className={css.marginAuto} />
                        {Icon.chevronDoubleLeft()}
                    </div>
                    <div className={css.vbox(20).fillWidth.minHeight(0).fillHeight}>
                        <div className={
                            css.display("grid")
                                .gridTemplateColumns("1fr 2fr 1fr")
                                .fillWidth
                                .flexShrink0
                        }>
                            <div className={css.hbox(10)}>
                                <b>Time Breakdown</b>
                                {(["year", "month", "week", "day", "hour", "minute2"] as const).map(inc =>
                                    <Button
                                        lightness={inc === currentIncrement ? 10 : -30}
                                        onClick={() => incrementTypeURL.value = inc}
                                        invertHover={inc !== currentIncrement}
                                    >
                                        {incrementSubs[inc].subType.toUpperCase()}
                                    </Button>
                                )}
                            </div>
                            <div className={css.fillWidth.hbox(10).justifyContent("center")}>
                                <div className={css.hbox(10).fontSize(30)}>
                                    {formatFullIncrementParts(currentTime, currentIncrement, "long").map(part =>
                                        <Button onClick={() => incrementTypeURL.value = part.type}>
                                            <div className={css.hbox(5)}>
                                                {part.value}
                                                {Icon.chevronDown()}
                                            </div>
                                        </Button>
                                    )}
                                </div>
                            </div>
                            <div className={css.fillWidth.hbox(20).justifyContent("end")}>
                                <div className={css.hbox(10)}>
                                    <b>Preview Size</b>
                                    {[100, 200, 400, 600, 800, 1200, 1600, 1800, 2000, 2400].map(size =>
                                        <Button
                                            hue={180}
                                            lightness={gridSize === size ? 0 : -30}
                                            onClick={() => gridSizeURL.value = size + ""}
                                            invertHover={gridSize !== size}
                                        >
                                            {size}
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className={css.hbox(14).pad2(0, 10).wrap.overflowAuto}>
                            {subRanges.ranges.map(range => {
                                let rangeRange = range.end - range.start;

                                let { ranges, thumb, thumbIsGood } = getRangeData(range);

                                let isCenter = range.start <= currentTime && currentTime < range.end;
                                let drillDown = () => {
                                    this.synced.viewTime = range.start;
                                    incrementTypeURL.value = subIncrement;
                                };
                                return (
                                    <div
                                        className={
                                            css.relative.minWidth(gridSize / 2).minHeight(gridSize / 2)
                                                .pointer
                                                .vbox(2).center
                                            + (isCenter && css.outline("1px solid hsl(103, 90%, 73%)", "important"))
                                            // + (!thumbIsGood && css.bord(1, "hsl(0, 0%, 60%)"))
                                            // + css.outline("1px solid hsl(0, 0%, 60%)", "hover")
                                        }
                                        title={`${thumb && !thumbIsGood && `(${thumb})` || ""} ${formatFullIncrement(range.start, subIncrement, "long")} ${getTimeFolder({ time: range.start, speedMultiplier: getSpeed() })}`}
                                        onClick={(e) => videoManager.seekToTime(range.start)}
                                        onMouseDown={e => {
                                            // If right click
                                            if (e.button === 1) {
                                                e.preventDefault();
                                                drillDown();
                                            }
                                        }}
                                    >
                                        {thumbIsGood &&
                                            <img
                                                className={css.pos(0, 0).maxWidth(gridSize * 2).maxHeight(gridSize * 2)}
                                                src={thumb}
                                            /> || undefined
                                        }
                                        <div className={css.hsla(0, 0, 20, 0.65).pad2(6, 4).relative.absolute.top0.left0}>
                                            {formatSingleIncrement(range.start, subIncrement)}
                                        </div>
                                        {ranges.map(r => <div className={
                                            css.absolute
                                                .top0.height(4)
                                                .left(`${(r.time - range.start) / rangeRange * 100}%`)
                                                .width(`${(r.endTime - r.time) / rangeRange * 100}%`)
                                                .offsety("-100%")
                                                .hsl(103, 90, 73)
                                        } />)}
                                        <Button onClick={() => drillDown()}>
                                            View Range
                                        </Button>
                                    </div>
                                );
                            })}
                            {subRanges.ranges.length === 0 &&
                                <h1>(No videos in range)</h1>
                            }
                        </div>
                        <div
                            className={
                                css.size("100%", 50).center
                                    .hbox(10)
                                    .textAlign("center")
                                    .hsl(0, 0, 5).background("hsl(0, 0%, 15%)", "hover", "important")
                                    .pointer
                                    .colorhsl(0, 0, 70)
                                    .pad2(10, 0)
                                    .flexShrink0
                            }
                            onClick={() => {
                                this.synced.expanded = false;
                                this.synced.viewTime = 0;
                                incrementTypeURL.value = "";
                            }}
                        >
                            {Icon.chevronDoubleDown()}
                        </div>
                    </div>
                    <div
                        className={
                            css.size(50, "100%").center
                                .vbox(10)
                                .textAlign("center")
                                .hsl(0, 0, 5).background("hsl(0, 0%, 15%)", "hover", "important")
                                .pointer
                                .colorhsl(0, 0, 70)
                                .pad2(0, 10)
                        }
                        onClick={() => this.synced.viewTime = getNextIncrement(currentTime, currentIncrement)}
                    >
                        {Icon.chevronDoubleRight()}
                        <div className={css.marginAuto} />
                        {formatSingleIncrement(getNextIncrement(currentTime, currentIncrement), currentIncrement)}
                        <div className={css.marginAuto} />
                        {Icon.chevronDoubleRight()}
                    </div>
                </div>
            </div>
        );
    }
}

export type IncrementType = "second" | "minute" | "minute2" | "second2" | "hour" | "hour6" | "day" | "week" | "week2" | "month" | "year" | "decade";
export let incrementSubs: {
    [key in IncrementType]: { type: IncrementType; subType: IncrementType; }
} = {
    second: { type: "second", subType: "second" },
    second2: { type: "second2", subType: "second2" },
    minute: { type: "minute", subType: "second" },
    minute2: { type: "minute2", subType: "second2" },
    hour: { type: "hour", subType: "minute2" },
    hour6: { type: "hour6", subType: "hour" },
    day: { type: "day", subType: "hour" },
    week: { type: "week", subType: "hour6" },
    week2: { type: "week2", subType: "day" },
    month: { type: "month", subType: "day" },
    year: { type: "year", subType: "week2" },
    decade: { type: "decade", subType: "year" },
};
export let incrementUps: { [key in IncrementType]: IncrementType } = {
    second: "minute",
    second2: "minute",
    minute: "hour",
    minute2: "hour",
    hour: "day",
    hour6: "day",
    day: "week",
    week: "month",
    week2: "month",
    month: "year",
    year: "decade",
    decade: "decade",
};

export function getStartOfIncrement(time: number, type: IncrementType): number {
    let d = new Date(time);
    if (type === "second") {
        d.setMilliseconds(0);
    } else if (type === "second2") {
        d.setMilliseconds(0);
        // Round to nearest 2 seconds
        let seconds = d.getSeconds();
        let half = seconds % 2 === 1;
        if (half) {
            d.setSeconds(seconds - 1);
        }
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
        d.setHours(Math.floor(d.getHours() / 6) * 6);
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
    } else if (type === "decade") {
        d.setHours(0);
        d.setMinutes(0);
        d.setSeconds(0);
        d.setMilliseconds(0);
        d.setMonth(0);
        d.setDate(1);
        d.setFullYear(Math.floor(d.getFullYear() / 10) * 10);
    } else {
        let unhandled: never = type;
    }
    return d.getTime();
}
export function incrementMedianSize(type: IncrementType): number {
    if (type === "second") return 1000;
    if (type === "second2") return 2000;
    if (type === "minute") return 60000;
    if (type === "minute2") return 60000 * 2;
    if (type === "hour") return 3600000;
    if (type === "hour6") return 3600000 * 6;
    if (type === "day") return 86400000;
    if (type === "week") return 86400000 * 7;
    if (type === "week2") return 86400000 * 14;
    if (type === "month") return 86400000 * 30;
    if (type === "year") return 86400000 * 365;
    if (type === "decade") return 86400000 * 365 * 10;
    let unhandled: never = type;
    throw new Error("Unhandled type: " + unhandled);
}
export function getNextIncrement(time: number, type: IncrementType): number {
    time = getStartOfIncrement(time, type);
    time += incrementMedianSize(type) * 1.5;
    return getStartOfIncrement(time, type);
}
export function getPrevIncrement(time: number, type: IncrementType): number {
    time = getStartOfIncrement(time, type);
    time--;
    return getStartOfIncrement(time, type);
}
function hourShort(time: number): string {
    // 12 PM
    let d = new Date(time);
    let hours = d.getHours();
    let ampm = hours < 12 ? "AM" : "PM";
    hours = hours % 12;
    if (hours === 0) hours = 12;
    return `${hours} ${ampm}`;
}
function timeOfDayTime(time: number): string {
    let hours = new Date(time).getHours();
    if (hours === 0) return "🌑"; //return "Midnight"; 🌃
    if (hours === 6) return "🌅"; //return "Morning";
    if (hours === 12) return "☀️"; //return "Noon";
    if (hours === 18) return "🌇"; // return "Evening";
    return hourShort(time);
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
let shortDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
let longDays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
let shortMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
let longMonths = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function formatSingleIncrement(time: number, type: IncrementType, long?: "long"): string {
    time = getStartOfIncrement(time, type);
    let d = new Date(time);
    let days = long ? longDays : shortDays;
    let months = long ? longMonths : shortMonths;
    if (type === "second") return hourMinuteSecond(time);
    if (type === "second2") return hourMinuteSecond(time);
    if (type === "minute") return hourMinuteSecond(time);
    if (type === "minute2") return formatSingleIncrement(time, "minute");
    if (type === "hour") return hourMinuteSecond(time);
    if (type === "hour6") {
        return d.getDate() + " " + days[d.getDay()] + " " + timeOfDayTime(time);
    }
    if (type === "day") return d.getDate() + " " + days[d.getDay()];
    // Month - Day
    if (type === "week") return formatFullIncrement(time, "month") + " " + d.getDate();
    if (type === "week2") return formatSingleIncrement(time, "week");
    if (type === "month") return months[d.getMonth()];
    if (type === "year") return d.getFullYear() + "";
    if (type === "decade") return d.getFullYear() + "";
    let unhandled: never = type;
    throw new Error("Unhandled type: " + unhandled);
}
export function formatFullIncrementParts(time: number, type: IncrementType, long?: "long"): {
    type: IncrementType;
    value: string;
}[] {
    let fullFormat = [
        { type: "year" as const, value: formatSingleIncrement(time, "year", long) },
        { type: "month" as const, value: formatSingleIncrement(time, "month", long) },
        { type: "day" as const, value: formatSingleIncrement(time, "day", long) },
        { type: "hour" as const, value: hourMinuteSecond(time) },
    ];
    let count = fullFormat.length;
    if (type === "second") count = 4;
    if (type === "minute") count = 4;
    if (type === "minute2") count = 4;
    if (type === "hour") count = 4;
    if (type === "hour6") count = 4;
    if (type === "day") count = 3;
    if (type === "week") count = 3;
    if (type === "month") count = 2;
    if (type === "year") count = 1;
    if (type === "decade") count = 1;
    return fullFormat.slice(0, count);
}
export function formatFullIncrement(time: number, type: IncrementType, long?: "long"): string {
    return formatFullIncrementParts(time, type, long).map(x => x.value).join(" | ");
}
export function getIncrementSubRanges(time: number, type: IncrementType, subType = incrementSubs[type].subType): {
    ranges: {
        start: number;
        end: number;
    }[];
} {
    let start = getStartOfIncrement(time, type);
    let end = getNextIncrement(time, type);
    let cur = start;
    let ranges: { start: number; end: number; }[] = [];
    while (true) {
        let next = getNextIncrement(cur, subType);
        ranges.push({ start: cur, end: next, });
        cur = next;
        if (cur >= end) break;
    }
    return {
        ranges,
    };
}