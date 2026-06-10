# Changelog

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
