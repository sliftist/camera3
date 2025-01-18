#!/bin/bash

# Variables
SHARED_FOLDER="/home/pi/output"
CLIENT_IP="10.0.0.192"
EXPORTS_FILE="/etc/exports"

echo "$SHARED_FOLDER $CLIENT_IP(rw,sync,no_subtree_check)" | sudo tee -a "$EXPORTS_FILE"

sudo exportfs -ra
sudo systemctl restart nfs-kernel-server
