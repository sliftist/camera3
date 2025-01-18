#!/bin/bash

ssh 10.0.0.192 "mkdir -p /home/pi/c"
scp -r ./c pi@10.0.0.192:/home/pi/

ssh 10.0.0.192 "cd ./c/ && bash ./build.sh"
ssh 10.0.0.192 "cd ./c/ && bash ./killprev.sh"
#ssh 10.0.0.192 "export VC_LOGLEVEL=mmal:trace,mmalsrv:trace && cd ./c && ./main"
ssh 10.0.0.192 "cd ./c && ./main"