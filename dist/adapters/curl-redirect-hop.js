export function isFollowableRedirectStatus(status) {
  return status >= 300 && status < 400 && status !== 304;
}
export function planCurlRedirectHop(status, method, location, currentUrl) {
  if (!isFollowableRedirectStatus(status) || !location)
    return null;
  const url = new URL(location, currentUrl).toString();
  if (status === 301 || status === 302 || status === 303)
    return { dropBody: true, method: "GET", url };
  return { dropBody: false, method: method.toUpperCase(), url };
}
