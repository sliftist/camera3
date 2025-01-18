export const MAX_DISK_USAGE = 1024 * 1024 * 1024 * 120;
export const MAX_FILE_COUNT = 300 * 1000;


// NOTE: For anything but 1, we split into keyframes. SO, if there is a keyframe every 30 frames,
//  we will sample at most 1 out of every 30 frames, making the minimum speed 30x.
export const speedGroups = [1, 30, 30 * 10, 30 * 60, 60 * 60 * 4, 60 * 60 * 24, 60 * 60 * 24 * 14];

// NOTE: activity.py hardcodes these as well
export const jpegSuffixes = [
    { suffix: "   size2=100.jpeg", width: 100 },
    { suffix: "   size2=200.jpeg", width: 200 },
    { suffix: "   size2=400.jpeg", width: 400 },
    { suffix: "   size2=full.jpeg", width: 1920, },
];