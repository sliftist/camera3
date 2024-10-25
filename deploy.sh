#!/bin/bash

bash update.sh
ssh 10.0.0.76 "killall screen"
ssh 10.0.0.76 "bash ~/startup.sh"