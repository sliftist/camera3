UNFIXABLE BUGS
    - sshfs is flakey, and sometimes hangs forever
        - And sometimes it just dies
    - Sometimes /dev/video0 goes away. We can switch, but I think that video crashes as well, etc, etc, until there is nothing let by /dev/video10, which I think is an encoded, which then hangs forever.

BUG (can't repro)
    Video keeps disappearing / being deleted?
        - Is the cleanup code deleting random video? But it's not even running...
            - Are we... doing something else that breaks the video? Hmm...
            - Is it just the drive occasionally erroring out, which we consider meaning the video is missing?

Play high speed data correctly
    - We need to adjust how we play it
        - I think we need to adjust our baseTime, and... scale the time down? Ugh...
        - Basically... { inputEncodeStartTime, inputEncodeEndTime }, and then a "INTERNAL_MAX_VIDEO_SIZE", we can map times to a fraction, and then to the internal time

4) FPS control
    - Buttons, one being "natural" which is only available for 1x, and which is not clickable, but always shows the current FPS
    - For sped up video default to 60FPS
    - Natural / 60fps / 120fps / 144fps
    - Test 120fps
        - For testing show for non-sped up video. This is kind of bad, but... also useful.

Update VideoManager to use a queue to manage operations
    - Load => .currentTime set => play
    - Forces things to run in order
    - BUT, allow clearing the queue
        - We can break up most operations so cancellation isn't required.
        - Loading data into the sourceBuffer will require checking to verify it hasn't been detached.
    - Log the queue, so we can tell what it's doing, when it's done, and what it will do next
    - UPDATE the gap jumper to look at the queue, so it only jumps gaps when we're idle
        - AND update it to just poll, so we never miss jumping gaps
        - Verify it on some gaps (and we can even create some gaps to test it)

ALSO, fix previews not showing
    - Maybe this will just be fixed anyways? But... I don't think so. I think when we load video and then set currentTime the preview isn't showing until we start playing. Maybe we need to play for a second then stop playing?

VERIFY on our choppy incorrectly timed video, which might require gap jumping (although it might also play normally...)


Serverside python activity code
    - Find activity, and delete video with no activity (keeping a buffer of a few files between activity and deleting)
    - FIRST, just log the activity ranges, and manually verify them

IMPORTANT! During playback, if we fail to find a file (because the activity code deleted it), wait a second, and then tell the videoLookup to update, and when it finishes, use this to get the file at the time, and try again.
    - Otherwise processing will break playback, which it shouldn't...

Python script to re-encode sped up video
    - New file names, via a new priority value
    - If we detect data with this type, we will ignore anything it overlaps (at all) with, that has a lower priority
        - We can also use this to detect files we have yet to re-encode

Pre-thumbnail generation
    - Could probably do this when finding activity
        - Because activity tracking looks at EVERY frame of the sped up code, this might not map to EVERY 1x segment, but... it should map to most of them. And every sped up segment will get a frame (many, but we just want the first)
    - Storing beside each video, for each segment
        - AND, only on video with activity
        - Create thumbnail2, which still locally caches, but then gets it off the adjacent jpeg (and maybe falls back to "thumbnail.ts" if there is no adjacent jpeg)
    - Make sure to gc these in fix.ts, when we limit size
        - AND in activity deletion

RTP streaming
    - Get the video by polling the file as it is written VERY frequently. This should give us < 1 second latency (on getting the NALs at least)
    - WebRTC (S)RTP / DTLS
    - SRTP eats the DTLS connection, like websockets do, which makes things difficult
        - ALTHOUGH, maybe this means we don't have to implement MOST of DTLS, so we could implement it ourself?
        - We COULD try to find a SRTP server. Apparently gstreamer handles is?
        - And... the web connections is extremely particular and wants us to pre-load it with session ids, ice credentials?, etc.
            - We could try it without them?
        - We MIGHT be able to craft a static SDP
    - TRY to get it working with GSTREAMER.
        - Apparently whipclientsink might do what we want?
        - https://claude.ai/chat/7da8d224-01b6-4700-b793-de6729fe8bf9
    - OH! And we apparently need to steal the entire connection with SRTP, and use a key passed in the extension.
    - We'll need a real cert as well, so... we'll need a letsencrypt loop, etc. Probably just a screen, which creates a new cert every week.
    - We can setup the DNS manually, the IP won't change often
    
Display connected to main raspberry pi, which shows the live video?

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