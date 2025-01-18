
@echo off
setlocal


set PATH=C:\\Program Files\\SSHFS-Win\\bin
sshfs.exe -v -d -o reconnect,ServerAliveInterval=15,ServerAliveCountMax=3,FileSystemName=NTFS,idmap=user,workaround=rename,max_conns=100,ConnectTimeout=5 quent@10.0.0.192:/ V:


endlocal