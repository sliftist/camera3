#!/bin/bash

ssh 10.0.0.76 "mkdir -p /home/pi/c"
scp -r ./c pi@10.0.0.76:/home/pi/

ssh 10.0.0.76 "cd ./c/ && bash ./build.sh"
ssh 10.0.0.76 "cd ./c/ && bash ./killprev.sh"
#ssh 10.0.0.76 "export VC_LOGLEVEL=mmal:trace,mmalsrv:trace && cd ./c && ./main"
ssh 10.0.0.76 "cd ./c && ./main"