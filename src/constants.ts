export const MAX_DISK_USAGE = 1024 * 1024 * 1024 * 200;


// NOTE: For anything but 1, we split into keyframes. SO, if there is a keyframe every 30 frames,
//  we will sample at most 1 out of every 30 frames, making the minimum speed 30x.
export const speedGroups = [1, 60, 60 * 10, 60 * 60, 60 * 60 * 24, 60 * 60 * 24 * 14];