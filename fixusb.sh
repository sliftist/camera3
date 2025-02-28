#!/bin/bash

echo "$(date) - Running fixusb.sh" 

# Wait until 3am
current_hour=$(date +%H)
if [ $current_hour -lt 3 ]; then
    # Before 3am, sleep until 3am today
    sleep_seconds=$(( (3 - current_hour) * 3600 - $(date +%M) * 60 ))
else
    # After 3am, sleep until 3am tomorrow
    sleep_seconds=$(( (27 - current_hour) * 3600 - $(date +%M) * 60 ))
fi
echo "Waiting $sleep_seconds seconds"
sleep $sleep_seconds
echo "$(date) - Cleanup now"
killall screen
sleep 1
sudo umount -l /dev/sdb1
sleep 10
sudo fsck -v /dev/sdb1
sleep 1
echo "$(date) - Rebooting now"
sleep 1
sudo reboot