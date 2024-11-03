#!/bin/bash

bash update.sh
ssh 10.0.0.189 "killall screen"
ssh 10.0.0.189 "bash ~/startup.sh"