import { throttleFunction } from "socket-function/src/misc";
import { observable } from "../misc/mobxTyped";
import preact from "preact";
import { css } from "typesafecss";
import { observer } from "../misc/observer";

let watchState = observable({
    pending: {} as { [group: string]: string }
});

let pendingCache = new Map<string, string>();

// "" clears the pending value
export function setPending(group: string, message: string) {
    pendingCache.set(group, message);
    void setPendingBase();
}

// NOTE: This not only prevents render overload, but also means any pending that are < this
//  delay don't show up (which is useful to reduce unnecessary pending messages).
const setPendingBase = throttleFunction(500, function setPendingBase() {
    for (let [group, message] of pendingCache) {
        console.log("setPending", group, message);
        if (!message) {
            delete watchState.pending[group];
        } else {
            watchState.pending[group] = message;
        }
    }
    pendingCache.clear();
});

@observer
export class PendingDisplay extends preact.Component {
    render() {
        // Single line, giving equal space, and ellipsis for overflow
        return <div className={css.hbox(10)}>
            {Object.keys(watchState.pending).map(group => (
                <div className={css.center.textOverflow("ellipsis").border("1px solid black").pad2(6, 2)}>
                    {group}: {watchState.pending[group]}
                </div>
            ))}
        </div>;
    }
}