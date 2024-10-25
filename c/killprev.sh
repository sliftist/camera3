# Define the video device (e.g., /dev/video0)
VIDEO_DEVICE="/dev/video0"

# Find any processes using the video device
PIDS=$(lsof $VIDEO_DEVICE | awk 'NR>1 {print $2}')

if [ -z "$PIDS" ]; then
    echo "No processes are using $VIDEO_DEVICE."
else
    echo "The following processes are using $VIDEO_DEVICE and will be killed:"
    lsof $VIDEO_DEVICE

    # Kill the processes
    for PID in $PIDS; do
        echo "Killing process $PID..."
        kill -9 $PID

        # Check if the process was successfully killed
        if kill -0 $PID 2>/dev/null; then
            echo "Failed to kill process $PID."
        else
            echo "Process $PID successfully killed."
        fi
    done
fi