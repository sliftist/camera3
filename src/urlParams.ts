import { URLParamStr } from "./misc/URLParam";

export const adjustRateURL = new URLParamStr("rate");
export const incrementTypeURL = new URLParamStr("inc");
export const gridSizeURL = new URLParamStr("gridSize");
export const playTimeURL = new URLParamStr("t");

const speedFolderName = new URLParamStr("speed");
export function getSpeedFolderName() {
    return speedFolderName.value || "1x";
}
export function setSpeed(value: number) {
    speedFolderName.value = value + "x";
    incrementTypeURL.value = "";
    // Have to reload, to update all of the caches
    window.location.reload();
}
export function getSpeed() {
    let speed = parseFloat(getSpeedFolderName());
    if (isNaN(speed)) return 1;
    return speed;
}

export function getVideoRate() {
    return +adjustRateURL.value || 1;
}



export type TimeRange = {
    start: number;
    end: number;
};
const timeRangeURL = new URLParamStr("timeRange");

export const loopTimeRangeURL = new URLParamStr("loopTimeRange");

export function getSelectedTimeRange(): TimeRange | undefined {
    let value = timeRangeURL.value;
    if (!value) return undefined;
    let [start, end] = value.split("-").map(parseFloat);
    if (isNaN(start) || isNaN(end)) return undefined;
    return { start, end };
}
export function setSelectedTimeRange(range: TimeRange | undefined) {
    if (!range) {
        timeRangeURL.value = "";
    } else {
        timeRangeURL.value = range.start + "-" + range.end;
    }
}
