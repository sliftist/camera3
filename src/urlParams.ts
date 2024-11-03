import { URLParamStr } from "./misc/URLParam";

export const adjustRateURL = new URLParamStr("rate");

const speedFolderName = new URLParamStr("speed");
export function getSpeedFolderName() {
    return speedFolderName.value || "1x";
}
export function setSpeed(value: number) {
    speedFolderName.value = value + "x";
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