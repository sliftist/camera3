UNFIXABLE BUGS
    - sshfs is flakey, and sometimes hangs forever
        - And sometimes it just dies
    - Sometimes /dev/video0 goes away. We can switch, but I think that video crashes as well, etc, etc, until there is nothing let by /dev/video10, which I think is an encoded, which then hangs forever.



Show current FPS indicator (at least on hover!)
    - Just the fps of the video, from its key
    - ALSO, bitrate
    - In top right, and move other stats to top left


REPRO
    - Load page at time
    - CLick on time 4 hours in the past
    - We get an error when loading, and it never loads...

Fix flakey seeking
    - When seeking a large amount it jumps around a bit
    - Something is still running which sets the currentTime, when it shouldn't
        - Maybe the gap jumper? Hmm...
        - Maybe we should have the gap jumper actually check if there is a gap in the videos?
    - Maybe we need to rewrite VideoManager entirely
        - Maybe when loading a new SourceBuffer we need to entirely lock down the video element, rejecting all previous requests?
ALSO, fix flakey playback
    - It seems to get stuck, on one frame, then jump to the next. It MIGHT be because of how we are encoding/parsing the video (maybe we need to just generate the SPS ourself?), or... it might be how we manage playback? (Or just how we encode the frame rate, or... how the SPS is encoded anyways)

Folder nesting!
    1) Update fix.ts to nest based on timestamp
        - Folder timestamp is based on NOW (it's unrelated to the contents)
        - Timestamp is rounded up to 10 seconds (so each folder will have about 10 seconds of video)
        - Each digit gets it's own folder
        - Root is "1x", because... eventually we'll write more
        - 1 keyframe per file
            - make sure sps/pps is there, and if not, try to copy it, and otherwise... I guess that's fine, it'll break on decoding, but at least we won't lose the video.
        - AH, and... now tracking size is a BIT more difficult. But... we can just cache the existing files (we should really be doing this anyways), and reading nested folders isn't so bad anyways
            - BUT, in preparation for external deletes... make delete batching, via making the deleteTo threshold below the deleteAt threshold (ex, delete at 100GB, and delete to 90GB) AND, recheck the size before deleting, in case files were deleted (and also... only check every 15 minutes, in case we are right on the threshold and all new data is being deleted, so we keep crossing the threshold).
    1.1) Sped up video files
        - Round up to when the file will finish, assuming a key frame every second as input, and 30 frames per output file
        - Only if the width/height is the same
        - Only if the times are within 5 * speed factor `frame times of the last raw video frame` time of each other
        - Show FPS control (ONLY for sped up video)
            - Default to 60
            - Test 120fps
                - For testing show for non-sped up video. This is kind of bad, but... also useful.
    1.2) Add sped up video folder selection in the header
    2) Create IStoragePath, and implement IStoragePath<Buffer> (not sync version though)
        - Discovered and if a flag is set, when we load filestorage, we nest it immediate.
        - All of our caches, etc, should just work, as they are stored in this folder as well
        - Store the original handle, in case we want root collections
    3) Reading
        - New interface: { startTime; endTime; files: string[] }
        - Folder maps to a time (even root folders, by assuming the remaining digits are 9)
        - If `folder time < readTime - timeInMinute * 5`, we can cache it and never read it again
        - We'll then be reading equal to the digits, and because of time rounding to 10 seconds, this means we'll read about 9 folders every time (so... now many, and each has at most 10 files/folders!)

Setup inside camera, and test with that instead (so we can get more motion)


Python script to re-encode sped up video
    - Just directly replaces files, so the file existence cache can be kept
    - Do a rename swap, so... it should be safe?

Serverside python diff code
    - Find activity, and delete video with no activity (keeping a buffer of a few files between activity and deleting)
    - FIRST, just log the activity ranges, and manually verify them




Maybe nice to have
    Lower latency live stream
        - Read more often?
        - Read the actively writing file, up to a keyframe, and play that?
    Cloud storage
        - Mostly for sped up video, which we will have a LOT less of (especially at 100X speed? Although with only keyframes maybe we need 1000X speed)



NOTE2
    this command will backup the pi sd
    (IF THE DRIVE IS CORRECT, run diskpart then list disk to know)
        dd if=\\.\PhysicalDrive9 of=D:\repos\camera3\pi.img bs=4M",
NOTE3
    this command will restore the pi sd

    Manually have to run these steps...    
        diskpart
        list disk
        select disk 9
        clean

    Then in an admin terminal
        dd of=\\.\PhysicalDrive9 if=D:\repos\camera3\pi.img bs=4M",

TEST g-streamer commands
    gst-launch-1.0 -vv -e v4l2src device=/dev/video0 num-buffers=100 ! capsfilter caps="image/jpeg,width=1920,height=1080,framerate=30/1" ! multifilesink location="frame%d.jpeg"

    time gst-launch-1.0 multifilesrc location="frame%d.jpeg" index=1 caps="image/jpeg,framerate=30/1, width=1920, height=1080" ! jpegdec ! videoconvert ! x264enc ! filesink location="output.h264" && stat output.h264

    time gst-launch-1.0 multifilesrc location="frame%d.jpeg" index=1 caps="image/jpeg,framerate=30/1, width=1920, height=1080" ! jpegdec ! videoconvert ! openh264enc ! filesink location="output.h264" && stat output.h264

    time gst-launch-1.0 multifilesrc location="frame%d.jpeg" index=1 caps="image/jpeg,framerate=30/1, width=1920, height=1080" ! jpegdec ! videoconvert ! openh264enc bitrate=2000000 rate-control=2 gop-size=30 ! filesink location="output.h264" && stat output.h264

    time gst-launch-1.0 multifilesrc location="frame%d.jpeg" index=1 caps="image/jpeg,framerate=30/1, width=1920, height=1080" ! jpegdec ! videoconvert ! v4l2h264enc output-io-mode=4 extra-controls="encode,video_bitrate_mode=2,h264_level=11;" ! 'video/x-h264,level=(string)4,profile=main' ! filesink location="output.h264" && stat output.h264

    time gst-launch-1.0 multifilesrc location="frame%d.jpeg" index=1 caps="image/jpeg,framerate=30/1, width=1920, height=1080" ! jpegdec ! videoconvert ! v4l2h264enc output-io-mode=4 extra-controls="encode,video_bitrate_mode=2,h264_level=11,video_bitrate=5000000" ! 'video/x-h264,level=(string)4,profile=main' ! h264parse ! mp4mux ! filesink location="output.mp4" && stat output.mp4

    

    gst-launch-1.0 --no-fault -e v4l2src device=/dev/video0 ! capsfilter caps="image/jpeg,width=1280,height=720,framerate=30/1" ! jpegdec ! videoconvert ! video/x-raw,format=I420,width=1280,height=720 ! clockoverlay time-format="%D %H:%M:%S" ! v4l2h264enc output-io-mode=4 extra-controls="encode,video_bitrate_mode=2,h264_level=11,video_bitrate=5000000" ! "video/x-h264,level=(string)4,profile=main" ! multifilesink location="/media/video/output/frames_%03d.nal" next-file=key-frame



    time gst-launch-1.0 multifilesrc location="frame%d.jpeg" index=1 caps="image/jpeg,framerate=30/1, width=1920, height=1080" ! jpegdec ! videoconvert ! openh264enc bitrate=2000000 rate-control=2 gop-size=30 ! filesink location="output.h264" && stat output.h264
    

SETUP

MAKE SURE TO IMAGE WITH "quent" (or the same as your user), otherwise there are issues...

Find the inital ip
    nmap -p22 10.0.0.0/24 | grep -B 4 "open" | grep "scan report" | cut -d " " -f 5

Assuming the usb is "/dev/sda1" (if it isn't, use lsblk to find the sda value)


sudo apt update
sudo apt install -y screen nodejs npm gstreamer1.0-tools gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly gstreamer1.0-libav
sudo npm install --global yarn

(crontab -l 2>/dev/null; echo "@reboot /usr/bin/pmount /dev/sda1 video") | crontab -
(crontab -l 2>/dev/null; echo "@reboot bash /home/quent/startup.sh") | crontab -
echo "gpu_mem=512" | sudo tee -a /boot/firmware/config.txt
mkdir -p /home/quent/camera3
mkdir -p /home/quent/camera3/src

sudo nmcli connection modify preconfigured ipv4.addresses 10.0.0.76/24
sudo nmcli connection modify preconfigured ipv4.gateway 10.0.0.1
sudo nmcli connection modify preconfigured ipv4.dns 8.8.8.8
sudo nmcli connection modify preconfigured ipv4.method manual
sudo nmcli connection down preconfigured && sudo nmcli connection up preconfigured && sudo reboot

(this command "hangs", because it changes the nextwork config, so... detach after this)


Now video is at /media/video, and the ip is 10.0.0.76, video memory is 512


The first `bash deploy.sh` will require a manual `yarn install`
`bash update.sh` can update the commands after that