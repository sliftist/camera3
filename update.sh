#!/bin/bash

scp -r ./src/*.ts 10.0.0.76:/home/quent/camera3/src
scp -r ./package.json 10.0.0.76:/home/quent/camera3/package.json
scp -r ./command.txt 10.0.0.76:/home/quent/command.txt
scp -r ./command2.txt 10.0.0.76:/home/quent/command2.txt
scp -r ./startup.sh 10.0.0.76:/home/quent/startup.sh