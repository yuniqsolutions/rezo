const pendingHandshakes = new WeakMap;
function trackPendingProxyHandshake(request, socket) {
  let sockets = pendingHandshakes.get(request);
  if (!sockets) {
    sockets = new Set;
    pendingHandshakes.set(request, sockets);
  }
  sockets.add(socket);
}
function releasePendingProxyHandshake(request, socket) {
  pendingHandshakes.get(request)?.delete(socket);
}
function destroyPendingProxyHandshake(request, error) {
  const sockets = pendingHandshakes.get(request);
  if (!sockets)
    return 0;
  let closed = 0;
  for (const socket of sockets) {
    sockets.delete(socket);
    if (socket.destroyed)
      continue;
    socket.destroy(error);
    closed += 1;
  }
  return closed;
}

exports.trackPendingProxyHandshake = trackPendingProxyHandshake;
exports.releasePendingProxyHandshake = releasePendingProxyHandshake;
exports.destroyPendingProxyHandshake = destroyPendingProxyHandshake;