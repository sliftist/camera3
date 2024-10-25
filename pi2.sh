#!/bin/bash

ssh 10.0.0.76 "mkdir -p /home/pi/py"
scp -r ./py 10.0.0.76:/home/pi/

#ssh 10.0.0.76 "cd ./py/ && pip3 install -r requirements.txt"
ssh 10.0.0.76 "cd ./py/ && python3 run.py"