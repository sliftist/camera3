import { URLParamStr } from "./misc/URLParam";

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