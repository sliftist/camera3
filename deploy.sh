#!/bin/bash

bash update.sh
ssh 10.0.0.192 "killall screen"
ssh 10.0.0.192 "bash ~/startup.sh"