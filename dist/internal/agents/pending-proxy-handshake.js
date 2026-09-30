const pendingHandshakes = new WeakMap;
export function trackPendingProxyHandshake(request, socket) {
  let sockets = pendingHandshakes.get(request);
  if (!sockets) {
    sockets = new Set;
    pendingHandshakes.set(request, sockets);
  }
  sockets.add(socket);
}
export function releasePendingProxyHandshake(request, socket) {
  pendingHandshakes.get(request)?.delete(socket);
}
export function destroyPendingProxyHandshake(request, error) {
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
