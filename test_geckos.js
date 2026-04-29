const geckos = require('@geckos.io/server').default;
const io = geckos();
io.onConnection(channel => {
  console.log(typeof channel.broadcast.emit);
});
console.log("Ready to test");
