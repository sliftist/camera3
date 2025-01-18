#!/bin/bash

scp -r ./src/*.ts 10.0.0.192:/home/quent/camera3/src
scp -r ./src/*.js 10.0.0.192:/home/quent/camera3/src
scp -r ./src/*.py 10.0.0.192:/home/quent/camera3/src
ssh 10.0.0.192 "mkdir -p /home/quent/camera3/src/storage/"
scp -r ./src/storage/*.ts 10.0.0.192:/home/quent/camera3/src/storage
scp -r ./src/storage/*.tsx 10.0.0.192:/home/quent/camera3/src/storage

ssh 10.0.0.192 "mkdir -p /home/quent/camera3/src/misc/"
scp -r ./src/misc/*.ts 10.0.0.192:/home/quent/camera3/src/misc
scp -r ./src/misc/*.tsx 10.0.0.192:/home/quent/camera3/src/misc

scp -r ./package.json 10.0.0.192:/home/quent/camera3/package.json
scp -r ./command.txt 10.0.0.192:/home/quent/command.txt
scp -r ./command2.txt 10.0.0.192:/home/quent/command2.txt
scp -r ./command3.txt 10.0.0.192:/home/quent/command3.txt
scp -r ./command4.txt 10.0.0.192:/home/quent/command4.txt
scp -r ./startup.sh 10.0.0.192:/home/quent/startup.sh
scp -r ./fixusb.sh 10.0.0.192:/home/quent/fixusb.sh