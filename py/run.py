import gi
gi.require_version('Gst', '1.0')
from gi.repository import Gst, GLib
import os

def capture_frame(output_filename='frame.jpeg'):
    # Initialize GStreamer
    Gst.init(None)

    # Define the GStreamer pipeline for capturing a frame from the camera
    pipeline_str = (
        "v4l2src ! "
        "videoconvert ! "
        "jpegenc ! "
        "filesink location=" + output_filename
    )
    
    # Create the pipeline
    pipeline = Gst.parse_launch(pipeline_str)

    # Start the pipeline
    pipeline.set_state(Gst.State.PLAYING)

    # Wait for the pipeline to process one frame
    bus = pipeline.get_bus()
    msg = bus.timed_pop_filtered(Gst.CLOCK_TIME_NONE, Gst.MessageType.EOS)

    if msg:
        print("Frame captured and saved to " + output_filename)
    
    # Stop the pipeline and clean up
    pipeline.set_state(Gst.State.NULL)

if __name__ == "__main__":
    capture_frame()


gst-launch-1.0 -e v4l2src device=/dev/video0 ! capsfilter caps="image/jpeg,width=1920,height=1080,framerate=30/1" \
    ! jpegdec \
    ! videoconvert \
    ! video/x-raw,format=I420,width=1920,height=1080 \
    ! omxh264enc \
    ! video/x-h264,profile=high \
    ! multifilesink location="frames_%01d.nal" next-file=key-frame