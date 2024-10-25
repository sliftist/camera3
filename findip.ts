import { exec } from 'child_process';
import { formatNumber, formatTime } from 'socket-function/src/formatting/format';

// Constants
const POLL_INTERVAL = 10000; // 10 seconds
const MAX_MISSED_POLLS = 3;
const MAX_NEWEST_IPS = 3;

interface IPInfo {
    firstSeen: number;
    missedPolls: number;
}

interface NewestIPEntry {
    ip: string;
    timestamp: number;
}

class IPTracker {
    private ipMap: Map<string, IPInfo>;
    private newestIPs: NewestIPEntry[];

    constructor() {
        this.ipMap = new Map<string, IPInfo>();
        this.newestIPs = [];
    }

    private async pollARP(): Promise<string> {
        return new Promise((resolve, reject) => {
            exec('arp -a', (error: Error | null, stdout: string, stderr: string) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(stdout);
            });
        });
    }

    private parseARPOutput(output: string): void {
        const currentTime = Date.now();
        const lines = output.split('\n');
        const currentIPs = new Set<string>();

        for (const line of lines) {
            const match = line.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
            if (match) {
                const ip = match[0];
                currentIPs.add(ip);

                if (!this.ipMap.has(ip)) {
                    this.ipMap.set(ip, { firstSeen: currentTime, missedPolls: 0 });
                    this.updateNewestIPs(ip, currentTime);
                } else {
                    const ipInfo = this.ipMap.get(ip);
                    if (ipInfo) {
                        ipInfo.missedPolls = 0;
                    }
                }
            }
        }

        this.updateMissedPolls(currentIPs);
    }

    private updateMissedPolls(currentIPs: Set<string>): void {
        for (const [ip, info] of this.ipMap) {
            if (!currentIPs.has(ip)) {
                info.missedPolls++;
                if (info.missedPolls >= MAX_MISSED_POLLS) {
                    this.ipMap.delete(ip);
                    this.newestIPs = this.newestIPs.filter((entry) => entry.ip !== ip);
                }
            }
        }
    }

    private updateNewestIPs(ip: string, timestamp: number): void {
        this.newestIPs.push({ ip, timestamp });
        this.newestIPs.sort((a, b) => b.timestamp - a.timestamp);
        if (this.newestIPs.length > MAX_NEWEST_IPS) {
            this.newestIPs.pop();
        }
    }

    private logStatus(): void {
        const currentTime = Date.now();
        console.clear();
        console.log('Current IP Map:');
        for (const [ip, info] of this.ipMap) {
            const firstSeenAge = formatTime(currentTime - info.firstSeen);
            console.log(`${ip}: First seen: ${firstSeenAge} ago, Missed polls: ${info.missedPolls}`);
        }

        console.log('\nNewest IPs:');
        this.newestIPs.forEach((entry) => {
            const age = formatTime(currentTime - entry.timestamp);
            console.log(`${entry.ip}: first seen ${age} ago`);
        });
    }

    public async start(): Promise<void> {
        console.log('ARP IP Tracker starting up...');
        console.log(`Polling interval: ${formatNumber(POLL_INTERVAL)} seconds`);
        console.log(`Max missed polls before removal: ${MAX_MISSED_POLLS}`);
        console.log(`Number of newest IPs tracked: ${MAX_NEWEST_IPS}`);
        console.log('Performing initial ARP poll...\n');

        try {
            const initialArpOutput = await this.pollARP();
            this.parseARPOutput(initialArpOutput);
            this.logStatus();
        } catch (error) {
            console.error('Error during initial ARP poll:', error);
        }

        setInterval(async () => {
            try {
                const arpOutput = await this.pollARP();
                this.parseARPOutput(arpOutput);
                this.logStatus();
            } catch (error) {
                console.error('Error polling ARP:', error);
            }
        }, POLL_INTERVAL);
    }
}

const tracker = new IPTracker();
tracker.start();