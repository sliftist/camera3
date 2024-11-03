#!/bin/bash

ssh 10.0.0.189 "mkdir -p /home/pi/py"
scp -r ./py 10.0.0.189:/home/pi/

#ssh 10.0.0.189 "cd ./py/ && pip3 install -r requirements.txt"
ssh 10.0.0.189 "cd ./py/ && python3 run.py"