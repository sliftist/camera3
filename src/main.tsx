import "./lib/buffer.js";
import { isNode } from "typesafecss";
import preact from "preact";
import { Page } from "./Page";
import { BUILD_PORT } from "../ports";

if (!isNode()) {
    if (location.hostname === "localhost") {
        const socket = new WebSocket(`ws://localhost:${BUILD_PORT}`);

        socket.onmessage = function (event) {
            if (event.data === "Build completed successfully") {
                location.reload();
            } else {
                console.log(event.data);
            }
        };
    }
}

if (!isNode()) {
    let main = document.createElement("main");
    document.body.appendChild(main);
    preact.render(<Page />, main);
}