import { cacheWeak } from "socket-function/src/caching";

export const addVideoHotkeys = cacheWeak((videoElement: HTMLVideoElement) => {
    const frameDelta = (delta: number) => {
        if (!videoElement) return;
        // Assuming standard 30fps for frame-by-frame navigation
        videoElement.currentTime += (delta * (1 / 30));
    };

    const seekVideo = (seconds: number) => {
        if (!videoElement) return;
        videoElement.currentTime += seconds;
    };

    const hotkeyHandlers: Record<string, () => void> = {
        "ArrowUp": () => {
            if (!videoElement) return;
            videoElement.volume = Math.min(1, videoElement.volume + 0.1);
        },
        "ArrowDown": () => {
            if (!videoElement) return;
            videoElement.volume = Math.max(0, videoElement.volume - 0.1);
        },
        "m": () => {
            if (!videoElement) return;
            videoElement.muted = !videoElement.muted;
        },
        "ArrowLeft": () => seekVideo(-5),
        "ArrowRight": () => seekVideo(5),
        "j": () => seekVideo(-5),
        "l": () => seekVideo(5),
        ",": () => frameDelta(-1),
        ".": () => frameDelta(1),
        "Ctrl+ArrowLeft": () => frameDelta(-1),
        "Ctrl+ArrowRight": () => frameDelta(1),
        " ": () => {
            if (!videoElement) return;
            if (videoElement.paused) {
                void videoElement.play();
            } else {
                videoElement.pause();
            }
        },
        "Enter": () => {
            if (!videoElement) return;
            if (videoElement.paused) {
                void videoElement.play();
            } else {
                videoElement.pause();
            }
        },
        "k": () => {
            if (!videoElement) return;
            if (videoElement.paused) {
                void videoElement.play();
            } else {
                videoElement.pause();
            }
        },
        "f": () => {
            if (!videoElement) return;
            void videoElement.requestFullscreen();
        },
        "Ctrl+r": () => {
            location.reload();
        }
    };

    const onKeyDown = (e: KeyboardEvent) => {
        // Ignore if it is for an input, text area, etc
        const ignore = (
            e.target instanceof HTMLInputElement ||
            e.target instanceof HTMLTextAreaElement ||
            e.target instanceof HTMLSelectElement
        );
        if (ignore) return;

        let key = e.key;
        if (e.ctrlKey) key = "Ctrl+" + key;
        if (e.shiftKey) key = "Shift+" + key;

        const handler = hotkeyHandlers[key];
        if (handler) {
            e.preventDefault();
            e.stopPropagation();
            handler();
        }
    };

    // There's no reason to focus the video element, except to use hotkeys, but... we support
    //  that anyways. Otherwise, focusing the element just breaks things.
    videoElement.addEventListener("focus", () => {
        videoElement.blur();
    });
    videoElement.addEventListener("click", () => {
        if (videoElement.paused) {
            void videoElement.play();
        } else {
            videoElement.pause();
        }
    });

    // Add the event listener
    document.addEventListener("keydown", onKeyDown);

    // Return cleanup function
    return () => {
        document.removeEventListener("keydown", onKeyDown);
    };
});