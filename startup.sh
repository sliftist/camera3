screen -dmS watch
screen -S watch -X stuff 'cd ~/camera3/ && node -r ./node_modules/typenode/index.js ./src/alwaysRunning.ts command.txt\n'

screen -dmS fix
screen -S fix -X stuff 'cd ~/camera3/ && node -r ./node_modules/typenode/index.js ./src/alwaysRunning.ts command2.txt\n'