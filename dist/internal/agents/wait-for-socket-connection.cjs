function waitForSocketConnection(socket) {
  return new Promise((resolve, reject) => {
    const detach = () => {
      socket.removeListener("connect", onConnect);
      socket.removeListener("error", onError);
      socket.removeListener("close", onClose);
    };
    const onConnect = () => {
      detach();
      resolve();
    };
    const onError = (error) => {
      detach();
      reject(error);
    };
    const onClose = () => {
      detach();
      reject(new Error("Socket closed before the connection was established"));
    };
    socket.once("connect", onConnect);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

exports.waitForSocketConnection = waitForSocketConnection;