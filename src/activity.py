import cv2
import json
import sys
import numpy as np

# Get path from the command line
path = sys.argv[1]
threshold = int(sys.argv[2])
outputJpegPath = sys.argv[3]

# ONLY 1 thread, otherwise we break other processes
cv2.setNumThreads(1)

kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))

def process_frames(frames):
    changes = []
    mostActivityFrame = None

    base = frames[0].copy()
    
    for i in range(len(frames)):
        current = frames[i].copy()
        
        # Set the timestamp area to black in both frames
        halfWidth = current.shape[1] // 2
        current[0:120, 0:halfWidth] = [0, 0, 0]
        base[0:120, 0:halfWidth] = [0, 0, 0]
        
        # Convert to grayscale for simpler differencing
        curr_gray = cv2.cvtColor(current, cv2.COLOR_BGR2GRAY)
        next_gray = cv2.cvtColor(base, cv2.COLOR_BGR2GRAY)
        
        # Calculate absolute difference
        diff = cv2.absdiff(curr_gray, next_gray)
        
        # Threshold the difference
        _, thresh = cv2.threshold(diff, 30, 255, cv2.THRESH_BINARY)
        
        # Apply morphological operations
        thresh = cv2.erode(thresh, kernel, iterations=1)
        thresh = cv2.dilate(thresh, kernel, iterations=1)
        
        # Find contours
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        sumChanged = sum(cv2.contourArea(c) for c in contours)
        
        if sumChanged > threshold:
            if mostActivityFrame is None or mostActivityFrame["changes"] < sumChanged:
                mostActivityFrame = {"frame": frames[i], "changes": sumChanged}
        
        changes.append(sumChanged)
    
    changes.append(0)  # Add final frame with 0 changes
    return changes, mostActivityFrame

# Read all frames first
frames = []
video = cv2.VideoCapture(path)
while True:
    ret, frame = video.read()
    if not ret:
        break
    frames.append(frame)
video.release()

# Process in forward direction
forward_changes, forward_most_active = process_frames(frames)

# Process in reverse direction
reverse_changes, reverse_most_active = process_frames(frames[::-1])
reverse_changes = reverse_changes[::-1]  # Flip back to match forward order

# Choose the direction with lower total changes
total_forward = sum(forward_changes)
total_reverse = sum(reverse_changes)

# Comparing in both directions filters out cases where the first frame has
#       a change (in which case, it would result in a lot of total changes
#       because the base would be different than most frames).
if total_forward <= total_reverse:
    changes = forward_changes
    mostActivityFrame = forward_most_active
else:
    changes = reverse_changes
    mostActivityFrame = reverse_most_active

if mostActivityFrame is not None:
    curChanges = mostActivityFrame["changes"]

    def writeImage(path, frame):
        # Write metadata beside it
        with open(path + ".metadata", "w") as f:
            f.write(json.dumps({"changes": curChanges, "allChanges": changes}))
        cv2.imwrite(path, frame)

    fullJpegPath = outputJpegPath + "   size2=full.jpeg"
    writeImage(fullJpegPath, mostActivityFrame["frame"])
    
    def emitPreview(width):
        jpegPath = outputJpegPath + f"   size2={width}.jpeg"
        frame = mostActivityFrame["frame"]
        fullWidth, fullHeight = frame.shape[1], frame.shape[0]
        height = int((width / fullWidth) * fullHeight)
        writeImage(jpegPath, cv2.resize(frame, (width, height)))
    
    emitPreview(400)
    emitPreview(200)
    emitPreview(100)

# Log changes as JSON
print(json.dumps(changes))