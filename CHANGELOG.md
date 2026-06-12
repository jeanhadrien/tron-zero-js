# Changelog

## [1.5.0](https://github.com/jeanhadrien/tron-zero-js/compare/tron-zero-v1.4.1...tron-zero-v1.5.0) (2026-06-12)


### Features

* **bot:** update bot management to use player IDs and implement rotation logic ([0468ed1](https://github.com/jeanhadrien/tron-zero-js/commit/0468ed1799de1594df65c8f67460042cc0b4e96f))
* **chat:** remove spawn ([2c8041b](https://github.com/jeanhadrien/tron-zero-js/commit/2c8041bc9f727fa1fdc6c054b38c4ef17606bc37))
* **client:** implement spectate cycling and update camera behavior based on player state ([511c293](https://github.com/jeanhadrien/tron-zero-js/commit/511c293812813fc22d47380732a446114c4abb8d))
* **server:** update environment configuration and add WebRTC port settings ([0048338](https://github.com/jeanhadrien/tron-zero-js/commit/00483388a9c954fa674ec9e1255a4a1e57601bbc))


### Bug Fixes

* **client:** 120 tick rate +split render ([28663d2](https://github.com/jeanhadrien/tron-zero-js/commit/28663d2d03fd6f1cfdae37ad7fa964d3edb4fb82))
* **client:** update PlayerRenderDatum to include isColliding property ([511c293](https://github.com/jeanhadrien/tron-zero-js/commit/511c293812813fc22d47380732a446114c4abb8d))
* **player:** enhance velocity calculations ([7c4b2f1](https://github.com/jeanhadrien/tron-zero-js/commit/7c4b2f122647609631fac740fabb74ca55e3e058))
* **simulation:** integrate EntityIdMapStore for entity ID management ([e4737bd](https://github.com/jeanhadrien/tron-zero-js/commit/e4737bdacca7972024eb10b4c2b587508b82b2c9))
* **simulation:** prevent unnecessary map clearing in replace method ([1c2d477](https://github.com/jeanhadrien/tron-zero-js/commit/1c2d47713fb5cb4a1bd95a746800d4852659b824))

## [1.4.1](https://github.com/jeanhadrien/tron-zero-js/compare/tron-zero-v1.4.0...tron-zero-v1.4.1) (2026-06-10)


### Bug Fixes

* **network:** port ([7604c3d](https://github.com/jeanhadrien/tron-zero-js/commit/7604c3d3da08cf1a505e8e1affb55eb34e47060a))

## [1.4.0](https://github.com/jeanhadrien/tron-zero-js/compare/tron-zero-v1.3.0...tron-zero-v1.4.0) (2026-06-10)


### Features

* **ci:** ci ([e654e68](https://github.com/jeanhadrien/tron-zero-js/commit/e654e6820580fc81f85318bd75b25a34e7d84901))

## [1.3.0](https://github.com/jeanhadrien/tron-zero-js/compare/tron-zero-v1.2.0...tron-zero-v1.3.0) (2026-06-10)


### Features

* add build ([6bf60a6](https://github.com/jeanhadrien/tron-zero-js/commit/6bf60a63bce8c4111a0ac52c372ebd038ddd3bae))

## [1.2.0](https://github.com/jeanhadrien/tron-zero-js/compare/tron-zero-v1.1.0...tron-zero-v1.2.0) (2026-06-10)


### Features

* **ci:** ci ([571c7f6](https://github.com/jeanhadrien/tron-zero-js/commit/571c7f6334fd97f93daeced92643a7e9d608ab68))

## [1.1.0](https://github.com/jeanhadrien/tron-zero-js/compare/tron-zero-v1.0.0...tron-zero-v1.1.0) (2026-06-10)


### Features

* **bots:** names ([c0f9bf9](https://github.com/jeanhadrien/tron-zero-js/commit/c0f9bf9a8703eb2b3738fa3344e7c33d3dbd25f3))
* **ci:** ci ([0b39e65](https://github.com/jeanhadrien/tron-zero-js/commit/0b39e658c5f2dffcaf41b20cacc3b7dac0f16ca0))
* **multi:** init ([c8f5679](https://github.com/jeanhadrien/tron-zero-js/commit/c8f5679d6f09f0df9107cd568727420b79b8b88f))
* **network:** lock geckos webrtc port range to 10000-20000 for gcp firewall rules ([4294850](https://github.com/jeanhadrien/tron-zero-js/commit/4294850361e5751e4b00fb1ace638032d0f6159b))
* **player:** increase acceleration sharpness when sliding and recovering ([44bbcbf](https://github.com/jeanhadrien/tron-zero-js/commit/44bbcbf1809cf1065d4af53d076de2bc84be055b))
* **player:** increase slide detection distance for acceleration ([9ddaff7](https://github.com/jeanhadrien/tron-zero-js/commit/9ddaff78a3821edf1b61c16f35c9424da30f3bd7))
* **player:** increase slide detection distance to 10 pixels ([8242f68](https://github.com/jeanhadrien/tron-zero-js/commit/8242f6872e88b848a140f358aefac6ffcaf9d439))
* setup authoritative server with headless phaser and socket.io sync ([a205283](https://github.com/jeanhadrien/tron-zero-js/commit/a205283b9e42e532dbf926d34dce7bd9a7ae4c03))
* **test:** test ([777cad1](https://github.com/jeanhadrien/tron-zero-js/commit/777cad1e64dbaf4dde9639c50fbfbae361e13b51))


### Bug Fixes

* **client:** use dynamic url and port for geckos client connection ([ca2d013](https://github.com/jeanhadrien/tron-zero-js/commit/ca2d01394e10a3dc381b50e9b519c90f02aa0ce4))
* explicitly define STUN iceServers for GCP NAT traversal ([7d5f208](https://github.com/jeanhadrien/tron-zero-js/commit/7d5f208a0fd0f2daae212cbde8fd1ed8dac7c2f8))
* **player:** add targetSpeed property to recover speed after collisions ([191c30c](https://github.com/jeanhadrien/tron-zero-js/commit/191c30c58cdd0de89044d08a238baa28acc67456))
* **player:** decelerate targetSpeed back to normal when not sliding against walls ([75123e4](https://github.com/jeanhadrien/tron-zero-js/commit/75123e4e59ca7fe81cb830e498a2c012d7d96831))
* **player:** decelerate targetSpeed to 1 when not sliding against walls ([785a8ae](https://github.com/jeanhadrien/tron-zero-js/commit/785a8ae21d40f59ec2dc61d7550789924c7a0138))
* **player:** maintain acceleration momentum when recovering from collisions ([37c802c](https://github.com/jeanhadrien/tron-zero-js/commit/37c802cb92beaabe53faf7c98d92a2f22a554a28))
* **player:** make speed track decaying targetSpeed and prevent momentum loss while stuck ([458afe5](https://github.com/jeanhadrien/tron-zero-js/commit/458afe571ce54e5bd5c2f17d0d59d9e00bd3946a))
* **player:** prevent erroneous self-collisions on tight turns ([bf49a77](https://github.com/jeanhadrien/tron-zero-js/commit/bf49a77fc562e18d0458e0db20a01b98693f58a1))
* remove jsdom-global override to fix headless phaser crash on google cloud ([47f323e](https://github.com/jeanhadrien/tron-zero-js/commit/47f323ea3d265a1c29b1a17edec275fe5f7b2575))

## Changelog
