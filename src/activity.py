# USE
# sudo apt-get install python3-opencv
# DO NOT pip install cv2, apt-get works better on the pi...
import cv2
import json

# Get path from the command line
import sys
path = sys.argv[1]
# mp4File thresholdNumber outputJpegPath
threshold = int(sys.argv[2])
outputJpegPath = sys.argv[3]

# ONLY 1 thread, otherwise we break other processes
cv2.setNumThreads(1)

mog = cv2.createBackgroundSubtractorMOG2()
kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))

frameIndex = 0

video = cv2.VideoCapture(path)
changes = []

# { frame, changes }
mostActivityFrame = None

# Log the frame sizes, to prove we have them
while True:
    ret, frame = video.read()
    if not ret:
        break
    # Set the timestamp area to black, otherwise it is always changing!
    halfWidth = frame.shape[1] // 2
    height = frame.shape[0]
    topPart = height // 8
    # Clone frame, in case we want to use it as a preview
    frameBase = frame.copy()
    frame[0:120, 0:halfWidth] = [0, 0, 0]
    #cv2.imwrite(f"/home/quent/test.jpg", frame)
    #break
    frame = mog.apply(frame, learningRate=0.01)
    frameIndex = frameIndex + 1
    if (frameIndex == 1):
        changes.append(0)
        continue
    frame = cv2.erode(frame, kernel, iterations=1)
    frame = cv2.dilate(frame, kernel, iterations=1)
    contours, hierarchy = cv2.findContours(frame, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    hasChange = False
    sumChanged = 0
    for c in contours:
        sumChanged += cv2.contourArea(c)

    if sumChanged > threshold:
        if mostActivityFrame is None or mostActivityFrame["changes"] < sumChanged:
            mostActivityFrame = { "frame": frameBase, "changes": sumChanged }

    changes.append(sumChanged)

if mostActivityFrame is not None:
    curChanges = mostActivityFrame["changes"]

    def writeImage(path, frame):
        # Write metadata beside it
        with open(path + ".metadata", "w") as f:
            f.write(json.dumps({ "changes": curChanges, "allChanges": changes }))
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