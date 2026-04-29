# Deployment Guide (Google Compute Engine)

Due to the use of Geckos.io (which relies on WebRTC DataChannels and UDP traffic), this game cannot be hosted on serverless platforms that drop UDP packets (like Google Cloud Run or Heroku). 

The recommended and most cost-effective way to host this game is on a raw Virtual Machine (VPS) where you can explicitly open the required UDP ports.

This guide outlines how to deploy the game to a Google Compute Engine (GCE) VM.

## 1. GCP Firewall Setup (Crucial)
Before creating your server, you must tell Google Cloud to allow the game's network traffic through its firewall.

1. Go to the Google Cloud Console.
2. Navigate to **VPC network > Firewall**.
3. Click **Create Firewall Rule**:
   * **Name:** `allow-geckos-game`
   * **Targets:** All instances in the network
   * **Source IPv4 ranges:** `0.0.0.0/0`
   * **Protocols and ports:**
     * Check `tcp` and enter: `3000` (For the HTTP signaling server)
     * Check `udp` and enter: `10000-20000` (For the WebRTC game traffic)
4. Click **Create**.

## 2. Create the Virtual Machine
1. Navigate to **Compute Engine > VM instances** and click **Create Instance**.
2. **Name:** `tron-zero-server` (or whatever you like).
3. **Region:** 
   * For the lowest cost (Free Tier eligible), choose a US region like `us-central1`, `us-east1`, or `us-west1`.
   * For the lowest latency for European players, choose `europe-west2` (London) or similar.
4. **Machine configuration:**
   * Series: `E2`
   * Machine type: `e2-micro` (1 GB RAM - Free Tier eligible) or `e2-small` (2 GB RAM - Better performance).
5. **Boot disk:** Leave as Debian or change to Ubuntu.
6. **Firewall:** Check both **Allow HTTP traffic** and **Allow HTTPS traffic**.
7. Click **Create**.

*Note: You may want to reserve a Static External IP address in **VPC network > IP addresses** and assign it to this VM so your IP never changes on reboot.*

## 3. Server Provisioning & Deployment
Once the VM is running, click the **SSH** button next to it in the GCP Console to open a terminal.

Run the following commands step-by-step:

### Step A: Install System Tools
```bash
sudo apt-get update && sudo apt-get install -y git curl unzip
```

### Step B: Install Bun
```bash
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
```

### Step C: Clone the Repository
Replace the URL with your actual repository URL.
```bash
git clone https://github.com/your-username/tron-zero-js.git
cd tron-zero-js
```

### Step D: Install Dependencies & Build
```bash
bun install
bun run build
```

### Step E: Start the Server (Background Process)
We use `pm2` to ensure the server stays running even after you close the SSH window, and restarts automatically if it crashes.
```bash
bun install -g pm2
pm2 start "bun run server" --name "tron-zero"
```

## 4. Play!
Find the **External IP** of your VM in the Compute Engine dashboard.
Open your browser and visit: `http://<VM_EXTERNAL_IP>:3000`

## Updating the Server Later
When you push new code to your repository, simply SSH back into the VM and run:
```bash
cd tron-zero-js
git pull
bun install
bun run build
pm2 restart tron-zero
```

## 5. Toggling the VM On/Off Easily
To avoid getting billed for unused time, you can easily stop and start your server using the `gcloud` CLI directly from your local terminal.

### Setup
1. Install the [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) on your local computer.
2. Run `gcloud auth login` and set your project: `gcloud config set project tron-zero-js`
3. Set your default zone (e.g. `europe-west2-a`): `gcloud config set compute/zone europe-west2-a`

### Commands
**Stop the server** (Stops billing for the CPU/RAM, you only pay pennies for the stored disk):
```bash
gcloud compute instances stop tron-zero-server
```

**Start the server**:
```bash
gcloud compute instances start tron-zero-server
```

*Note: Because we installed `pm2`, the game server will automatically start itself up a few seconds after the VM boots!*
