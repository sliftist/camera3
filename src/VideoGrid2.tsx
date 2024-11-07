import preact from "preact";
import { observer } from "./misc/observer";
import { VideoManager } from "./VideoManager";
import { URLParamStr } from "./misc/URLParam";
import { css } from "typesafecss";
import { observable } from "./misc/mobxTyped";
import { getThumbnailURL } from "./thumbnail";
import { getFileStorage } from "./storage/FileFolderAPI";
import { formatDateTime, formatNumber, formatTime } from "socket-function/src/formatting/format";
import { DiskCollectionRaw } from "./storage/DiskCollection";
import { Button } from "./Button";
import { binarySearchBasic, list } from "socket-function/src/misc";
import { Icon } from "./icons";
import { getVideoIndexSynced } from "./videoLookup";
import { getTimeFolder } from "./frameEmitHelpers";
import { getSpeed, gridSizeURL, incrementTypeURL, loopTimeRangeURL, playTimeURL, setSelectedTimeRange } from "./urlParams";
import { filterToRange, getThumbnailRange } from "./videoHelpers";


@observer
export class VideoGrid2 extends preact.Component<{
    videoManager: VideoManager;
    defaultIncrement?: IncrementType;
}> {
    synced = observable({
        expanded: 0,
        viewTime: 0,
        activityThreshold: 300 * 300,
    });
    setViewTime(time: number) {
        this.synced.viewTime = time;
        playTimeURL.value = time + "";
    }
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
        let startTime = getStartOfIncrement(currentTime, currentIncrement);
        let endTime = getNextIncrement(startTime, currentIncrement);

        if (!this.synced.expanded) {
            return (
                <div
                    className={
                        css.fillWidth.hbox(20).height(28).center.relative.pad2(4)
                            .hsl(0, 0, 20)
                            .button
                    }
                    onClick={() => this.synced.expanded = 1}
                >
                    {Icon.chevronDoubleUp()}
                </div>
            );
        }

        let index = getVideoIndexSynced();
        let firstTime = index.flatVideos[0]?.startTime || 0;
        let lastTime = index.flatVideos[index.flatVideos.length - 1]?.endTime || 0;

        let ranges = filterToRange(index.ranges, { start: startTime, end: endTime });

        return (
            <div className={
                css.vbox(10).fillHeight.pad2(10).margins2(10).width(`calc(100% - 20px)`).hsl(0, 0, 10).minHeight(0)
                + (this.synced.expanded === 1 && css.maxHeight("50vh"))
                + (this.synced.expanded === 2 && css.maxHeight("70vh"))
                + (this.synced.expanded === 2 && css.maxHeight("100%"))
            }>
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
                        this.synced.expanded++;
                    }}
                >
                    {Icon.chevronDoubleUp()}
                </div>
                <div className={
                    css.hbox(20).fillWidth
                }>
                    <div className={css.maxWidth("60%")}>
                        <CascadingRangeSelector
                            time={currentTime}
                            setTime={time => this.setViewTime(time)}
                            increment={currentIncrement}
                            setIncrement={increment => incrementTypeURL.value = increment}
                            firstTime={firstTime}
                            lastTime={lastTime}
                        />
                    </div>
                    <div className={css.marginAuto} />
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
                    <label className={css.hbox(4)}>
                        <span>Threshold Pixels</span>
                        <input
                            value={this.synced.activityThreshold}
                            type="number"
                            onChange={e => this.synced.activityThreshold = +e.currentTarget.value}
                        />
                    </label>
                </div>
                <div className={css.fillWidth.hbox(20)}>
                    <Button onClick={e => {
                        e.stopPropagation();
                        setSelectedTimeRange({ start: startTime, end: endTime });
                        videoManager.seekToTime(startTime);
                    }}>
                        Select
                    </Button>
                    <Button onClick={e => {
                        e.stopPropagation();
                        setSelectedTimeRange({ start: startTime, end: endTime });
                        videoManager.seekToTime(startTime);
                        videoManager.play();
                    }}>
                        Play
                    </Button>
                </div>
                <div className={css.hbox(14).pad2(2, 10).wrap.overflowAuto}>
                    {ranges.map(range => {
                        let thumb = getThumbnailRange(gridSize, {
                            start: range.startTime,
                            end: range.endTime,
                            threshold: this.synced.activityThreshold
                        });
                        let isCenter = range.startTime <= currentTime && range.endTime > currentTime;
                        let drillDown = () => {
                            this.setViewTime(range.startTime);
                            incrementTypeURL.value = subIncrement;
                        };
                        let thumbIsGood = thumb.startsWith("data:");
                        if (!thumbIsGood) return undefined;
                        return (
                            <div
                                className={
                                    css.relative.minWidth(gridSize / 2).minHeight(gridSize / 2)
                                        .pad2(2)
                                        .pointer
                                        .vbox(2).center
                                    + (isCenter && css.outline("1px solid hsl(103, 90%, 73%)", "important"))
                                    // + (!thumbIsGood && css.bord(1, "hsl(0, 0%, 60%)"))
                                    // + css.outline("1px solid hsl(0, 0%, 60%)", "hover")
                                }
                                title={`${formatFullIncrement(range.startTime, subIncrement, "long")} ${formatTime(range.endTime - range.startTime)}`}
                                onClick={(e) => {
                                    videoManager.seekToTime(range.startTime);
                                    videoManager.play();
                                }}
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
                                        className={css.pos(0, 0).maxWidth(gridSize).maxHeight(gridSize)}
                                        src={thumb}
                                    /> || undefined
                                }
                                <div className={css.hsla(0, 0, 20, 0.65).pad2(6, 4).relative.absolute.top0.left0}>
                                    {formatSingleIncrement(range.startTime, subIncrement)}
                                </div>
                                <div className={css.hsla(0, 0, 20, 0.65).pad2(6, 4).relative.absolute.top0.right0}>
                                    {formatSingleIncrement(range.endTime, subIncrement)}
                                </div>
                                <div className={css.hbox(10)}>
                                    <Button onClick={e => { e.stopPropagation(); drillDown(); }}>
                                        Expand
                                    </Button>
                                    <Button onClick={e => {
                                        e.stopPropagation();
                                        setSelectedTimeRange({ start: range.startTime, end: range.endTime });
                                        videoManager.seekToTime(range.startTime);
                                    }}>
                                        Select
                                    </Button>
                                    <Button onClick={e => {
                                        e.stopPropagation();
                                        setSelectedTimeRange({ start: range.startTime, end: range.endTime });
                                        videoManager.seekToTime(range.startTime);
                                        videoManager.play();
                                    }}>
                                        Play
                                    </Button>
                                </div>
                            </div>
                        );
                    })}
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
                        this.synced.expanded = 0;
                        this.setViewTime(0);
                        incrementTypeURL.value = "";
                    }}
                >
                    {Icon.chevronDoubleDown()}
                </div>
            </div>
        );
    }
}

@observer
class CascadingRangeSelector extends preact.Component<{
    time: number;
    setTime: (time: number) => void;

    increment: IncrementType;
    setIncrement: (increment: IncrementType) => void;

    firstTime: number;
    lastTime: number;
}> {
    render() {
        const { firstTime, lastTime, setTime, increment, setIncrement } = this.props;
        let { time } = this.props;
        const viewTypes: IncrementType[] = [
            "year",
            "month",
            "day",
            "hour",
        ];
        // incrementTypeURL

        time = Math.max(firstTime, time);
        time = Math.min(lastTime, time);

        let incrementRanges: {
            incrementType: IncrementType;
            ranges: { start: number; end: number; title: string }[];
        }[] = [];
        let curFirstTime = firstTime;
        let curLastTime = lastTime;
        for (let type of viewTypes) {
            let ranges = getIncrementSubRangesBase(curFirstTime, curLastTime, type).ranges;
            incrementRanges.push({
                incrementType: type,
                ranges: ranges.map(range => {
                    let title = formatSingleIncrement(range.start, type);
                    if (type === "hour") {
                        function formatHourShort(time: number): string {
                            // 12 PM
                            let d = new Date(time);
                            let hours = d.getHours();
                            let ampm = hours < 12 ? "AM" : "PM";
                            hours = hours % 12;
                            if (hours === 0) hours = 12;
                            return `${hours} ${ampm}`;
                        }
                        title = formatHourShort(range.start);
                    }
                    return { ...range, title };
                }),
            });

            // Drill down into the select range (or first if none are selected)
            let selectedRange = ranges.find(range => time >= range.start && time < range.end) || ranges[0];
            curFirstTime = Math.max(firstTime, selectedRange.start);
            curLastTime = Math.min(lastTime, selectedRange.end);
        }
        let selectedOrder = incrementOrder.indexOf(increment);
        let index = getVideoIndexSynced();

        return (
            <div className={css.vbox(12)}>
                {incrementRanges.map(({ incrementType, ranges }) => (
                    <div className={css.hbox(6).wrap}>
                        {ranges.map(range => {
                            let selected = range.start <= time && time < range.end;
                            if (selected && incrementOrder.indexOf(incrementType) > selectedOrder) {
                                selected = false;
                            }
                            let ranges = filterToRange(index.ranges, range);
                            let duration = ranges.map(x => x.duration).reduce((a, b) => a + b, 0);
                            return <Button
                                lightness={selected ? 0 : -30}
                                onClick={() => {
                                    setTime(range.start);
                                    setIncrement(incrementType);
                                }}
                                invertHover={selected}
                            >
                                {range.title} ({ranges.length})
                            </Button>;
                        })}
                    </div>
                ))}
            </div>
        );
    }
}

export type IncrementType = "second" | "minute" | "minute2" | "second2" | "hour" | "hour6" | "day" | "week" | "week2" | "month" | "year" | "decade";
let incrementOrder: IncrementType[] = [
    "decade", "year", "month", "day", "hour", "hour6",
    "week", "week2", "minute", "minute2", "second", "second2",
];
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
    function resetMilli() {
        // Just use times, as Date incorrectly handle DST
        d = new Date(+d - d.getMilliseconds());
    }
    function resetSeconds() {
        resetMilli();
        d = new Date(+d - d.getSeconds() * 1000);
    }
    function resetMinutes() {
        resetSeconds();
        d = new Date(+d - d.getMinutes() * 60000);
    }

    if (type === "second") {
        resetMilli();
    } else if (type === "second2") {
        resetMilli();
        // Round to nearest 2 seconds
        let seconds = d.getSeconds();
        let half = seconds % 2 === 1;
        if (half) {
            d.setSeconds(seconds - 1);
        }
    } else if (type === "minute") {
        resetSeconds();
    } else if (type === "minute2") {
        resetSeconds();
        // Round to nearest 2 minutes
        let minutes = d.getMinutes();
        let half = minutes % 2 === 1;
        if (half) {
            d = new Date(+d - 60000);
        }
    } else if (type === "hour") {
        resetMinutes();
    } else if (type === "hour6") {
        d.setHours(Math.floor(d.getHours() / 6) * 6);
        resetMinutes();
    } else if (type === "day") {
        d.setHours(0);
        resetMinutes();
    } else if (type === "week") {
        d.setHours(0);
        resetMinutes();
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
        resetMinutes();
    } else if (type === "month") {
        d.setHours(0);
        resetMinutes();
        d.setDate(1);
    } else if (type === "year") {
        d.setHours(0);
        resetMinutes();
        d.setMonth(0);
        d.setDate(1);
    } else if (type === "decade") {
        d.setHours(0);
        resetMinutes();
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
    let baseTime = time;
    time = getStartOfIncrement(time, type);
    time += incrementMedianSize(type) * 1.5;
    time = getStartOfIncrement(time, type);
    if (time <= baseTime) {
        // Happens due to daylight savings time
        time = getStartOfIncrement(baseTime, type);
        time += incrementMedianSize(type) * 2.5;
        time = getStartOfIncrement(time, type);
    }
    if (time <= baseTime) {
        // Time went backwards. We had issues related to DST here before, maybe this is similar?
        debugger;
        time = getStartOfIncrement(baseTime, type);
        time += incrementMedianSize(type) * 2.5;
        time = getStartOfIncrement(time, type);
    }
    return time;
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
    //time = getStartOfIncrement(time, type);
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
    return getIncrementSubRangesBase(start, end, subType);
}
export function getIncrementSubRangesBase(start: number, end: number, subType: IncrementType): {
    ranges: {
        start: number;
        end: number;
    }[];
} {
    let cur = start;
    let ranges: { start: number; end: number; }[] = [];
    while (ranges.length < 240) {
        let next = getNextIncrement(cur, subType);
        ranges.push({ start: cur, end: next, });
        cur = next;
        if (cur >= end) break;
    }
    return {
        ranges,
    };
}