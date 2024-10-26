import preact from "preact";
import { observer } from "./misc/observer";
import { css } from "typesafecss";
import { URLParamStr } from "./misc/URLParam";
import { FileStorageSynced } from "./storage/DiskCollection";
import { PendingDisplay } from "./storage/PendingManager";
import { sort } from "socket-function/src/misc";
import { H264toMP4 } from "mp4-typescript";
import { LargeBuffer } from "mp4-typescript/src/parser-lib/LargeBuffer";
import { RootBox } from "mp4-typescript/src/parser-implementations/BoxObjects";
import { parseObject, writeObject } from "mp4-typescript/src/parser-lib/BinaryCoder";
import { playVideo, VideoPlayer } from "./VideoPlayer";
import { findVideo, getVideoStartTime, parseVideoKey } from "./videoHelpers";
import { resetStorageLocation } from "./storage/FileFolderAPI";

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
        let allFiles = FileStorageSynced.getKeys();
        allFiles = allFiles.slice();
        allFiles.sort();
        allFiles.reverse();
        allFiles = allFiles.slice(0, 10);
        return (
            <div className={css.size("100vw", "100vh").overflowHidden.vbox0}>
                <div className={
                    css.display("grid")
                        .gridTemplateColumns("1fr 2fr 1fr")
                        .fillWidth
                }>
                    <div className={
                        css.hbox(10).alignItems("center")
                            .whiteSpace("nowrap")
                            .flexShrink0
                            .maxWidth("30vw")
                            .overflowHidden
                            .textOverflow("ellipsis")
                    }>
                        <PendingDisplay />
                    </div>
                    <div className={css.fillWidth}>

                    </div>
                    <div className={css.fillWidth.hbox(10).justifyContent("end")}>
                        <button onClick={() => resetStorageLocation()}>
                            Pick New Folder
                        </button>
                    </div>
                </div>
                <div className={css.fillBoth.minHeight(0)}>
                    <VideoPlayer />
                </div>
            </div>
        );
    }
}
