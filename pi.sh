#!/bin/bash

ssh 10.0.0.189 "mkdir -p /home/pi/c"
scp -r ./c pi@10.0.0.189:/home/pi/

ssh 10.0.0.189 "cd ./c/ && bash ./build.sh"
ssh 10.0.0.189 "cd ./c/ && bash ./killprev.sh"
#ssh 10.0.0.189 "export VC_LOGLEVEL=mmal:trace,mmalsrv:trace && cd ./c && ./main"
ssh 10.0.0.189 "cd ./c && ./main"