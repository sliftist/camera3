import preact from "preact";
import { observer } from "./misc/observer";
import { css } from "typesafecss";
import { URLParamStr } from "./misc/URLParam";
import { PendingDisplay, setPending } from "./storage/PendingManager";
import { sort } from "socket-function/src/misc";
import { playVideo, VideoPlayer } from "./VideoPlayer";
import { findVideo, getVideoStartTime, parseVideoKey } from "./videoHelpers";
import { resetStorageLocation } from "./storage/FileFolderAPI";
import { deleteVideoCache, forceRecheckAllNow, getAvailableSpeeds } from "./videoLookup";
import { getSpeed, setSpeed } from "./urlParams";
import { Button } from "./Button";
import { deleteThumbCache } from "./thumbnail";

export const pageURL = new URLParamStr("page");

@observer
export class Page extends preact.Component {
    async componentDidMount() {
        window.addEventListener("keydown", this.onKeyDown);
    }

    onKeyDown = (e: KeyboardEvent) => {
        // Ignore if it is for an input, text area, etc
        let ignore = (
            e.target instanceof HTMLInputElement ||
            e.target instanceof HTMLTextAreaElement ||
            e.target instanceof HTMLSelectElement
        );
        if (ignore) return;

        console.log("Checking hotkey", e.key, e);
        let key = e.key;
        if (e.ctrlKey) key = "Ctrl+" + key;
        if (e.shiftKey) key = "Shift+" + key;
        let hotkeyDataAttribute = `[data-hotkey="${key}"]`;
        let el = document.querySelector<HTMLElement>(hotkeyDataAttribute);
        if (el) {
            e.stopPropagation();
            e.preventDefault();
            console.log("Found hotkey", e.key, el);
            el.click();
        }
    };

    video: HTMLVideoElement | null = null;
    curVideoSeconds = 0;
    sourceBuffer: SourceBuffer | null = null;
    render() {
        return (
            <div className={css.size("100vw", "100vh").overflowHidden.vbox0}>
                <div className={
                    css.display("grid")
                        .gridTemplateColumns("1fr 1fr 1fr")
                        .fillWidth
                }>
                    <div className={
                        css.hbox(10).alignItems("center")
                            .whiteSpace("nowrap")
                            .flexShrink0
                            .maxWidth("40vw")
                            .overflowHidden
                            .textOverflow("ellipsis")
                    }>
                        <PendingDisplay />
                        <Button
                            hue={-5}
                            onClick={async () => {
                                setPending("Reset Cache", "working");
                                try {
                                    await deleteVideoCache();
                                    await deleteThumbCache();
                                    window.location.reload();
                                } catch (e: any) {
                                    setPending("Reset Cache", "error " + e.message);
                                    console.error("Failed to reset cache", e);
                                }
                            }}
                        >
                            Delete Cache
                        </Button>
                    </div>
                    <div className={css}>

                    </div>
                    <div className={css.fillWidth.hbox(20).justifyContent("end")}>
                        <Button onClick={() => forceRecheckAllNow()}>
                            Reload Videos
                        </Button>
                        <div className={css.hbox(5)}>
                            <b>Switch Speed</b>
                            {getAvailableSpeeds().map(speed => (
                                <Button
                                    hue={320}
                                    saturation={speed === getSpeed() ? 0 : -50}
                                    data-hotkey={speed}
                                    onClick={() => setSpeed(speed)}
                                >
                                    {speed}x
                                </Button>
                            ))}
                        </div>
                        <Button hue={320} onClick={() => resetStorageLocation()}>
                            Change Video Folder
                        </Button>
                    </div>
                </div>
                <div className={css.fillBoth.minHeight(0)}>
                    <VideoPlayer />
                </div>
            </div>
        );
    }
}
