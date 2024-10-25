UNFIXABLE BUGS
    - sshfs is flakey, and sometimes hangs forever
        - And sometimes it just dies
    - Sometimes /dev/video0 goes away. We can switch, but I think that video crashes as well, etc, etc, until there is nothing let by /dev/video10, which I think is an encoded, which then hangs forever.
todonext
- Overview control

Fix flakey seeking
    - When seeking a large amount it jumps around a bit
    - Something is still running which sets the currentTime, when it shouldn't
        - Maybe the gap jumper? Hmm...
        - Maybe we should have the gap jumper actually check if there is a gap in the videos?
    - Maybe we need to rewrite VideoManager entirely
        - Maybe when loading a new SourceBuffer we need to entirely lock down the video element, rejecting all previous requests?

Nice to have
    High speed versions
        - In fix.ts, as it already reads in values for frame counts
            - This is no longer needed, but... eh, might as well do it here, it's fairly cheap...
        - SUBFOLDER IN THE MAIN FOLDER
            - Discovered and if a flag is set, when we load filestorage, we nest it immediate (and track that we nested it).
            - Show buttons to switch to these different speeds, which keep the play time, but otherwise are entirely independent (they might have entirely different coverage, or even be different sources)
        - Show the setting in the header
            - ALSO, show option to change the root folder in general

    Find the maximum settings we can use before we start dropping frames
        - We MIGHT switch to 1080p 15fps... as the ability to see details is more important than motion... maybe?
        - ALSO, test setting the video to a faster speed (in <video> not based on how we encode it), and see how fast we can play it? Fast forward is nice, but if we can play at 10X speed at 720p, and only at 2.5X at 1080p... we'll probably want to use 720p, at least for now...

    Activity detection / filter
        - AH... if we run on the high speed version... it will be A LOT more efficient
        - Make a new dir with JUST motion
            - If this works, this will be the source for everything except the seed sped up version
        - We MIGHT be able to write code for this? Maybe just turn it into larger blocks?
        - TRY writing it all on one machine. If lags the video, we can run it on the PI instead
        - Might as well concatenate here as well!
        - SOFTWARE decoding, via a python script, so we don't lag the hardware encoding
            - we'll at most be running analysis at 1 frame per second, and even 1 frame per 5 seconds COULD be fine (this means we'd miss any events < 5 seconds).
        
    Video concatenation
        - Concatenate video after a bit, to reduce the file count
            - Otherwise we have 8640 files per day, which makes readdir slow. If we concatenate to 100 second clips, it should still be < 10MB per file, but with only 846 files a day we can have over 10 days for < 10K files
        - Probably done when detecting activity
    Re-encode sped up versions
        - It might play without re-encoding, but... if it's sped up enough, re-encoding should be fine in software

Maybe nice to have
    Low latency live stream
        - Read the active file, read up to the last keyframe, and play that (the easy part)
        - THEN, poll that file (frequently), and when it has (enough) more data, read it, and read just the frames for the prev last keyframe to the next one
        - We might be able to change the encoding settings to add a keyframe more frequently (once a second), which should give as little as 2 seconds latency (probably more like 3 or 4).
    Cloud storage
        - Mostly for sped up video, which we will have a LOT less of (especially at 100X speed? Although with only keyframes maybe we need 1000X speed)
    Buy a pi 4, and try tha latest firmware, it should be faster
        - It's supposed to be able to handle 30FPS 1080p
        - Try the latest pi firmware again, and see if increasing the vram is all we need to do to fix it?
        - ALSO, it has 5GHz internet, so... we might not need an adapter
        - Double check that we still have a micro hdmi cable
        - Get new charging adapters too, for 3A: https://www.amazon.ca/Charger-Boxeroo-Charge-4-Port-Galaxy/dp/B081RB32FH
    Try different encoding options, to see if we can improve the video quality (it's consistently overly dark now)
        https://raspberrypi.stackexchange.com/a/29546/86710
    Easy provisioning
        - Hot swap supporting SD reader
        - Automatic detection of sd card, at which point we automatically image it, with a confirmation window, and then progress bar popping up
        - Image which automatically connects to wifi, and reads configuration from github





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

    time gst-launch-1.0 multifilesrc location="frame%d.jpeg" index=1 caps="image/jpeg,framerate=30/1, width=1920, height=1080" ! jpegdec ! videoconvert ! v4l2h264enc output-io-mode=4 extra-controls="encode,video_bitrate_mode=2,h264_level=11;" ! 'video/x-h264,level=(string)4,profile=main' ! filesink location="output.h264" && stat output.h264

    time gst-launch-1.0 multifilesrc location="frame%d.jpeg" index=1 caps="image/jpeg,framerate=30/1, width=1920, height=1080" ! jpegdec ! videoconvert ! v4l2h264enc output-io-mode=4 extra-controls="encode,video_bitrate_mode=2,h264_level=11,video_bitrate=5000000" ! 'video/x-h264,level=(string)4,profile=main' ! h264parse ! mp4mux ! filesink location="output.mp4" && stat output.mp4

    


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